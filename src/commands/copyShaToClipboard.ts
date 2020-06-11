'use strict';
import { env, TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { Iterables } from '../system';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	isCommandViewContextWithCommit,
} from './common';

export interface CopyShaToClipboardCommandArgs {
	sha?: string;
}

@command()
export class CopyShaToClipboardCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.CopyShaToClipboard);
	}

	protected preExecute(context: CommandContext, args?: CopyShaToClipboardCommandArgs) {
		if (isCommandViewContextWithCommit(context)) {
			args = { ...args };
			args.sha = context.node.commit.sha;
			return this.execute(context.editor, context.node.commit.uri, args);
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyShaToClipboardCommandArgs) {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		try {
			// If we don't have an editor then get the sha of the last commit to the branch
			if (uri == null) {
				const repoPath = await Container.git.getActiveRepoPath(editor);
				if (!repoPath) return undefined;

				const log = await Container.git.getLog(repoPath, { limit: 1 });
				if (!log) return undefined;

				args.sha = Iterables.first(log.commits.values()).sha;
			} else if (args.sha === undefined) {
				const blameline = (editor && editor.selection.active.line) || 0;
				if (blameline < 0) return undefined;

				try {
					const gitUri = await GitUri.fromUri(uri);
					const blame =
						editor && editor.document && editor.document.isDirty
							? await Container.git.getBlameForLineContents(gitUri, blameline, editor.document.getText())
							: await Container.git.getBlameForLine(gitUri, blameline);
					if (blame === undefined) return undefined;

					args.sha = blame.commit.sha;
				} catch (ex) {
					Logger.error(ex, 'CopyShaToClipboardCommand', `getBlameForLine(${blameline})`);
					return Messages.showGenericErrorMessage('Unable to copy commit id');
				}
			}

			void (await env.clipboard.writeText(args.sha));
			return undefined;
		} catch (ex) {
			if (ex.message.includes("Couldn't find the required `xsel` binary")) {
				window.showErrorMessage(
					'Unable to copy commit id, xsel is not installed. Please install it via your package manager, e.g. `sudo apt install xsel`',
				);
				return undefined;
			}

			Logger.error(ex, 'CopyShaToClipboardCommand');
			return Messages.showGenericErrorMessage('Unable to copy commit id');
		}
	}
}
