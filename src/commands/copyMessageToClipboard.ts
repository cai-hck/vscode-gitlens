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

export interface CopyMessageToClipboardCommandArgs {
	message?: string;
	sha?: string;
}

@command()
export class CopyMessageToClipboardCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.CopyMessageToClipboard);
	}

	protected preExecute(context: CommandContext, args?: CopyMessageToClipboardCommandArgs) {
		if (isCommandViewContextWithCommit(context)) {
			args = { ...args };
			args.sha = context.node.commit.sha;
			return this.execute(context.editor, context.node.commit.uri, args);
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: CopyMessageToClipboardCommandArgs) {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		try {
			let repoPath;
			// If we don't have an editor then get the message of the last commit to the branch
			if (uri == null) {
				repoPath = await Container.git.getActiveRepoPath(editor);
				if (!repoPath) return undefined;

				const log = await Container.git.getLog(repoPath, { limit: 1 });
				if (!log) return undefined;

				args.message = Iterables.first(log.commits.values()).message;
			} else if (args.message === undefined) {
				const gitUri = await GitUri.fromUri(uri);
				repoPath = gitUri.repoPath;

				if (args.sha === undefined) {
					const blameline = (editor && editor.selection.active.line) || 0;
					if (blameline < 0) return undefined;

					try {
						const blame =
							editor && editor.document && editor.document.isDirty
								? await Container.git.getBlameForLineContents(
										gitUri,
										blameline,
										editor.document.getText(),
								  )
								: await Container.git.getBlameForLine(gitUri, blameline);
						if (!blame) return undefined;

						if (blame.commit.isUncommitted) return undefined;

						args.sha = blame.commit.sha;
						if (!repoPath) {
							repoPath = blame.commit.repoPath;
						}
					} catch (ex) {
						Logger.error(ex, 'CopyMessageToClipboardCommand', `getBlameForLine(${blameline})`);
						return Messages.showGenericErrorMessage('Unable to copy message');
					}
				}

				// Get the full commit message -- since blame only returns the summary
				const commit = await Container.git.getCommit(repoPath!, args.sha);
				if (commit === undefined) return undefined;

				args.message = commit.message;
			}

			void (await env.clipboard.writeText(args.message));
			return undefined;
		} catch (ex) {
			if (ex.message.includes("Couldn't find the required `xsel` binary")) {
				window.showErrorMessage(
					'Unable to copy message, xsel is not installed. Please install it via your package manager, e.g. `sudo apt install xsel`',
				);
				return undefined;
			}

			Logger.error(ex, 'CopyMessageToClipboardCommand');
			return Messages.showGenericErrorMessage('Unable to copy message');
		}
	}
}
