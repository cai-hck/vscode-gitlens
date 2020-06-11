'use strict';
import { env, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, ReferencesQuickPick } from '../quickpicks';
import { CompareResultsNode } from '../views/nodes';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	getRepoPathOrActiveOrPrompt,
	isCommandViewContextWithRef,
} from './common';

export interface DiffDirectoryCommandArgs {
	ref1?: string;
	ref2?: string;
}

@command()
export class DiffDirectoryCommand extends ActiveEditorCommand {
	constructor() {
		super([
			Commands.DiffDirectory,
			Commands.DiffDirectoryWithHead,
			Commands.ViewsOpenDirectoryDiff,
			Commands.ViewsOpenDirectoryDiffWithWorking,
		]);
	}

	protected async preExecute(context: CommandContext, args?: DiffDirectoryCommandArgs) {
		switch (context.command) {
			case Commands.DiffDirectoryWithHead:
				args = { ...args };
				args.ref1 = 'HEAD';
				args.ref2 = undefined;
				break;

			case Commands.ViewsOpenDirectoryDiff:
				if (context.type === 'viewItem' && context.node instanceof CompareResultsNode) {
					args = { ...args };
					[args.ref1, args.ref2] = await context.node.getDiffRefs();
				}
				break;

			case Commands.ViewsOpenDirectoryDiffWithWorking:
				if (isCommandViewContextWithRef(context)) {
					args = { ...args };
					args.ref1 = context.node.ref;
					args.ref2 = undefined;
				}
				break;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffDirectoryCommandArgs) {
		uri = getCommandUri(uri, editor);
		args = { ...args };

		try {
			const repoPath = await getRepoPathOrActiveOrPrompt(
				uri,
				editor,
				`Compare directory in which repository${GlyphChars.Ellipsis}`,
			);
			if (!repoPath) return undefined;

			if (!args.ref1) {
				const pick = await new ReferencesQuickPick(repoPath).show(
					`Compare Working Tree with${GlyphChars.Ellipsis}`,
					{
						allowEnteringRefs: true,
						checkmarks: false,
					},
				);
				if (pick === undefined) return undefined;

				if (pick instanceof CommandQuickPickItem) return pick.execute();

				args.ref1 = pick.ref;
				if (args.ref1 === undefined) return undefined;
			}

			Container.git.openDirectoryDiff(repoPath, args.ref1, args.ref2);
			return undefined;
		} catch (ex) {
			const msg = ex && ex.toString();
			if (msg === 'No diff tool found') {
				const result = await window.showWarningMessage(
					'Unable to open directory compare because there is no Git diff tool configured',
					'View Git Docs',
				);
				if (!result) return undefined;

				return env.openExternal(
					Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
				);
			}

			Logger.error(ex, 'DiffDirectoryCommand');
			return Messages.showGenericErrorMessage('Unable to open directory compare');
		}
	}
}
