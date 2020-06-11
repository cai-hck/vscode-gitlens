'use strict';
import { commands, TextEditor, Uri } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem } from '../quickpicks';
import { ActiveEditorCachedCommand, command, Commands, getCommandUri, getRepoPathOrActiveOrPrompt } from './common';
import { ShowQuickBranchHistoryCommandArgs } from './showQuickBranchHistory';

export interface ShowQuickCurrentBranchHistoryCommandArgs {
	goBackCommand?: CommandQuickPickItem;
}

@command()
export class ShowQuickCurrentBranchHistoryCommand extends ActiveEditorCachedCommand {
	constructor() {
		super(Commands.ShowQuickCurrentBranchHistory);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickCurrentBranchHistoryCommandArgs) {
		uri = getCommandUri(uri, editor);

		try {
			const repoPath = await getRepoPathOrActiveOrPrompt(
				uri,
				editor,
				`Show current branch history for which repository${GlyphChars.Ellipsis}`,
			);
			if (!repoPath) return undefined;

			const branch = await Container.git.getBranch(repoPath);
			if (branch === undefined) return undefined;

			const commandArgs: ShowQuickBranchHistoryCommandArgs = {
				branch: branch.name,
				repoPath: repoPath,
				goBackCommand: args && args.goBackCommand,
			};
			return commands.executeCommand(Commands.ShowQuickBranchHistory, uri, commandArgs);
		} catch (ex) {
			Logger.error(ex, 'ShowQuickCurrentBranchHistoryCommand');
			return Messages.showGenericErrorMessage('Unable to show branch history');
		}
	}
}
