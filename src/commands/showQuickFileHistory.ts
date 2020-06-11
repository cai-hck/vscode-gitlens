'use strict';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBranch, GitLog, GitReference, GitTag, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import {
	CommandQuickPickItem,
	FileHistoryQuickPick,
	OpenInFileHistoryViewQuickPickItem,
	ShowFileHistoryFromQuickPickItem,
} from '../quickpicks';
import { Iterables, Strings } from '../system';
import { ActiveEditorCachedCommand, command, CommandContext, Commands, getCommandUri } from './common';
import { ShowQuickCommitFileDetailsCommandArgs } from './showQuickCommitFileDetails';

export interface ShowQuickFileHistoryCommandArgs {
	reference?: GitBranch | GitTag | GitReference;
	log?: GitLog;
	limit?: number;
	range?: Range;
	showInView?: boolean;

	goBackCommand?: CommandQuickPickItem;
	nextPageCommand?: CommandQuickPickItem;
}

@command()
export class ShowQuickFileHistoryCommand extends ActiveEditorCachedCommand {
	constructor() {
		super([Commands.ShowFileHistoryInView, Commands.ShowQuickFileHistory]);
	}

	protected preExecute(context: CommandContext, args?: ShowQuickFileHistoryCommandArgs) {
		if (context.command === Commands.ShowFileHistoryInView) {
			args = { ...args };
			args.showInView = true;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickFileHistoryCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return commands.executeCommand(Commands.ShowQuickCurrentBranchHistory);

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };

		if (args.showInView) {
			await Container.fileHistoryView.showHistoryForUri(gitUri);

			return undefined;
		}

		const placeHolder = `${gitUri.getFormattedPath({
			suffix: args.reference ? ` (${args.reference.name})` : undefined,
		})}${gitUri.sha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${gitUri.shortSha}` : ''}`;

		const progressCancellation = FileHistoryQuickPick.showProgress(placeHolder);

		try {
			if (args.log === undefined) {
				args.log = await Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, {
					limit: args.limit,
					range: args.range,
					ref: (args.reference && args.reference.ref) || gitUri.sha,
				});
				if (args.log === undefined) {
					if (args.reference) {
						return window.showWarningMessage(`The file could not be found in ${args.reference.name}`);
					}
					return Messages.showFileNotUnderSourceControlWarningMessage('Unable to show file history');
				}
			}

			if (progressCancellation !== undefined && progressCancellation.token.isCancellationRequested) {
				return undefined;
			}

			let previousPageCommand: CommandQuickPickItem | undefined = undefined;

			if (args.log.hasMore) {
				let commandArgs: ShowQuickFileHistoryCommandArgs;
				commandArgs = { ...args, log: undefined };
				const npc = new CommandQuickPickItem(
					{
						label: '$(arrow-right) Show Next Commits',
						description: `shows ${args.log.limit} newer commits`,
					},
					Commands.ShowQuickFileHistory,
					[gitUri, commandArgs],
				);

				const last = Iterables.last(args.log.commits.values());
				if (last != null) {
					commandArgs = { ...args, log: undefined, nextPageCommand: npc };
					previousPageCommand = new CommandQuickPickItem(
						{
							label: '$(arrow-left) Show Previous Commits',
							description: `shows ${args.log.limit} older commits`,
						},
						Commands.ShowQuickFileHistory,
						[new GitUri(uri, last), commandArgs],
					);
				}
			}

			const icon = GitTag.isOfRefType(args.reference)
				? '$(tag) '
				: GitBranch.isOfRefType(args.reference)
				? '$(git-branch) '
				: '';
			// Create a command to get back to where we are right now
			const currentCommand = new CommandQuickPickItem(
				{
					label: `go back ${GlyphChars.ArrowBack}`,
					description: `to history of ${gitUri.getFormattedPath()}${
						args.reference
							? ` from ${GlyphChars.Space}${icon}${args.reference.name}`
							: gitUri.sha
							? ` from ${GlyphChars.Space}$(git-commit) ${gitUri.shortSha}`
							: ''
					}`,
				},
				Commands.ShowQuickFileHistory,
				[uri, args],
			);

			const showAllCommandArgs: ShowQuickFileHistoryCommandArgs = { ...args, log: undefined, limit: 0 };

			const pick = await FileHistoryQuickPick.show(args.log, gitUri, placeHolder, {
				progressCancellation: progressCancellation,
				currentCommand: currentCommand,
				goBackCommand: args.goBackCommand,
				nextPageCommand: args.nextPageCommand,
				previousPageCommand: previousPageCommand,
				showAllCommand:
					args.log !== undefined && args.log.hasMore
						? new CommandQuickPickItem(
								{
									label: '$(sync) Show All Commits',
									description: 'this may take a while',
								},
								Commands.ShowQuickFileHistory,
								[uri, showAllCommandArgs],
						  )
						: undefined,
				showInViewCommand:
					args.log !== undefined
						? new OpenInFileHistoryViewQuickPickItem(
								gitUri,
								(args.reference && args.reference.ref) || gitUri.sha,
						  )
						: undefined,
			});
			if (pick === undefined) return undefined;

			if (pick instanceof ShowFileHistoryFromQuickPickItem) {
				const reference = await pick.execute();
				if (reference === undefined) return undefined;
				if (reference instanceof CommandQuickPickItem) return reference.execute();

				const commandArgs: ShowQuickFileHistoryCommandArgs = {
					...args,
					log: undefined,
					reference: reference.item,
					goBackCommand: currentCommand,
				};
				return commands.executeCommand(Commands.ShowQuickFileHistory, gitUri, commandArgs);
			}

			if (pick instanceof CommandQuickPickItem) return pick.execute();

			const commandArgs: ShowQuickCommitFileDetailsCommandArgs = {
				commit: pick.item,
				fileLog: args.log,
				sha: pick.item.sha,
				goBackCommand: currentCommand,
			};

			return commands.executeCommand(Commands.ShowQuickCommitFileDetails, pick.item.toGitUri(), commandArgs);
		} catch (ex) {
			Logger.error(ex, 'ShowQuickFileHistoryCommand');
			return Messages.showGenericErrorMessage('Unable to show file history');
		} finally {
			progressCancellation && progressCancellation.cancel();
		}
	}
}
