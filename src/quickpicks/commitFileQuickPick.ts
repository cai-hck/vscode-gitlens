'use strict';
import { commands, QuickPickItem, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import {
	Commands,
	CopyMessageToClipboardCommandArgs,
	CopyRemoteFileUrlToClipboardCommandArgs,
	CopyShaToClipboardCommandArgs,
	DiffWithPreviousCommandArgs,
	findOrOpenEditor,
	OpenWorkingFileCommandArgs,
	ShowQuickCommitDetailsCommandArgs,
	ShowQuickCommitFileDetailsCommandArgs,
	ShowQuickFileHistoryCommandArgs,
} from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitLog, GitLogCommit, GitService, GitUri, RemoteResourceType } from '../git/gitService';
import { KeyCommand, KeyNoopCommand, Keys } from '../keyboard';
import { Strings } from '../system';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, KeyCommandQuickPickItem } from './commonQuickPicks';
import { OpenRemotesCommandQuickPickItem } from './remotesQuickPick';

export class ApplyCommitFileChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(
			item || {
				label: '$(git-pull-request) Apply Changes',
				description: `${commit.getFormattedPath()} from ${GlyphChars.Space}$(git-commit) ${commit.shortSha}`,
			},
			undefined,
			undefined,
		);
	}

	async execute(): Promise<{} | undefined> {
		const uri = this.commit.toGitUri();

		// Open the working file to ensure undo will work
		const args: OpenWorkingFileCommandArgs = {
			uri: uri,
			showOptions: { preserveFocus: true, preview: false },
		};
		void (await commands.executeCommand(Commands.OpenWorkingFile, undefined, args));

		void (await Container.git.applyChangesToWorkingFile(uri));

		return undefined;
	}
}

export class OpenCommitFileCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly _commit: GitLogCommit, item?: QuickPickItem) {
		super(
			item || {
				label: '$(file-symlink-file) Open File',
				description: `${_commit.getFormattedPath()}`,
			},
		);
	}

	execute(options?: TextDocumentShowOptions): Thenable<TextEditor | undefined> {
		const uri = this._commit.toGitUri();
		const args: OpenWorkingFileCommandArgs = {
			uri: uri,
			showOptions: options,
		};
		return commands.executeCommand(Commands.OpenWorkingFile, undefined, args);
	}

	async onDidPressKey(key: Keys): Promise<void> {
		await this.execute({
			preserveFocus: true,
			preview: false,
		});
	}
}

export class OpenCommitFileRevisionCommandQuickPickItem extends CommandQuickPickItem {
	private readonly _uri: Uri;

	constructor(commit: GitLogCommit, item?: QuickPickItem) {
		let description: string;
		let uri: Uri;
		if (commit.status === 'D') {
			uri = GitUri.toRevisionUri(commit.previousFileSha, commit.previousUri.fsPath, commit.repoPath);
			description = `${commit.getFormattedPath()} from ${GlyphChars.Space}$(git-commit) ${
				commit.previousShortSha
			} (deleted in ${GlyphChars.Space}$(git-commit) ${commit.shortSha})`;
		} else {
			uri = GitUri.toRevisionUri(commit.sha, commit.uri.fsPath, commit.repoPath);
			description = `${commit.getFormattedPath()} from ${GlyphChars.Space}$(git-commit) ${commit.shortSha}`;
		}

		super(
			item || {
				label: '$(file-symlink-file) Open Revision',
				description: description,
			},
		);

		this._uri = uri;
	}

	execute(options?: TextDocumentShowOptions): Thenable<TextEditor | undefined> {
		return findOrOpenEditor(this._uri, options);
	}

	async onDidPressKey(key: Keys): Promise<void> {
		await this.execute({
			preserveFocus: true,
			preview: false,
		});
	}
}

export class CommitFileQuickPick {
	static async show(
		commit: GitLogCommit,
		uri: Uri,
		goBackCommand?: CommandQuickPickItem,
		currentCommand?: CommandQuickPickItem,
		fileLog?: GitLog,
	): Promise<CommandQuickPickItem | undefined> {
		const items: CommandQuickPickItem[] = [];

		const stash = commit.isStash;

		const isUncommitted = commit.isUncommitted;
		if (isUncommitted) {
			// Since we can't trust the previous sha on an uncommitted commit, find the last commit for this file
			const c = await Container.git.getCommitForFile(undefined, commit.uri.fsPath);
			if (c === undefined) return undefined;

			commit = c;
		}

		const workingUri = await commit.getWorkingUri();

		if (stash) {
			items.push(new ApplyCommitFileChangesCommandQuickPickItem(commit));
		}

		if (commit.previousFileSha) {
			const commandArgs: DiffWithPreviousCommandArgs = {
				commit: commit,
			};

			const previousSha = await Container.git.resolveReference(
				commit.repoPath,
				commit.previousFileSha,
				commit.previousUri,
			);

			items.push(
				new CommandQuickPickItem(
					{
						label: '$(git-compare) Open Changes',
						description: `$(git-commit) ${GitService.shortenSha(previousSha)} ${
							GlyphChars.Space
						} $(git-compare) ${GlyphChars.Space} $(git-commit) ${commit.shortSha}`,
					},
					Commands.DiffWithPrevious,
					[commit.uri, commandArgs],
				),
			);
		}

		if (workingUri) {
			items.push(
				new CommandQuickPickItem(
					{
						label: '$(git-compare) Open Changes with Working File',
						description: `$(git-commit) ${commit.shortSha} ${GlyphChars.Space} $(git-compare) ${
							GlyphChars.Space
						} ${GitUri.getFormattedPath(workingUri, { relativeTo: commit.repoPath })}`,
					},
					Commands.DiffWithWorking,
					[GitUri.fromCommit(commit)],
				),
			);
		}

		if (workingUri && commit.status !== 'D') {
			items.push(new OpenCommitFileCommandQuickPickItem(commit));
		}
		items.push(new OpenCommitFileRevisionCommandQuickPickItem(commit));

		const remotes = await Container.git.getRemotes(commit.repoPath, { sort: true });
		if (remotes.length) {
			if (workingUri && commit.status !== 'D') {
				const branch = await Container.git.getBranch(commit.repoPath);
				if (branch !== undefined) {
					items.push(
						new OpenRemotesCommandQuickPickItem(
							remotes,
							{
								type: RemoteResourceType.File,
								fileName: GitUri.relativeTo(workingUri, commit.repoPath),
								branch: branch.name,
							},
							currentCommand,
						),
					);
				}
			}

			if (!stash) {
				items.push(
					new OpenRemotesCommandQuickPickItem(
						remotes,
						{
							type: RemoteResourceType.Revision,
							fileName: commit.fileName,
							commit: commit,
						},
						currentCommand,
					),
				);
			}
		}

		if (!stash) {
			items.push(new ApplyCommitFileChangesCommandQuickPickItem(commit));

			const copyShaCommandArgs: CopyShaToClipboardCommandArgs = {
				sha: commit.sha,
			};
			items.push(
				new CommandQuickPickItem(
					{
						label: '$(clippy) Copy Commit ID to Clipboard',
						description: '',
					},
					Commands.CopyShaToClipboard,
					[uri, copyShaCommandArgs],
				),
			);

			const copyMessageCommandArgs: CopyMessageToClipboardCommandArgs = {
				message: commit.message,
				sha: commit.sha,
			};
			items.push(
				new CommandQuickPickItem(
					{
						label: `$(clippy) Copy ${commit.isStash ? 'Stash' : 'Commit'} Message to Clipboard`,
						description: '',
					},
					Commands.CopyMessageToClipboard,
					[uri, copyMessageCommandArgs],
				),
			);

			if (remotes.length) {
				const copyRemoteUrlCommandArgs: CopyRemoteFileUrlToClipboardCommandArgs = {
					sha: commit.sha,
				};
				items.push(
					new CommandQuickPickItem(
						{
							label: '$(clippy) Copy Remote Url to Clipboard',
						},
						Commands.CopyRemoteFileUrlToClipboard,
						[uri, copyRemoteUrlCommandArgs],
					),
				);
			}
		}

		if (workingUri) {
			const commandArgs: ShowQuickFileHistoryCommandArgs = {
				log: fileLog,
				goBackCommand: currentCommand,
			};
			items.push(
				new CommandQuickPickItem(
					{
						label: '$(history) Show File History',
						description: `of ${commit.getFormattedPath()}`,
					},
					Commands.ShowQuickFileHistory,
					[workingUri, commandArgs],
				),
			);
		}

		if (!stash) {
			const fileHistoryCommandArgs: ShowQuickFileHistoryCommandArgs = {
				goBackCommand: currentCommand,
			};
			items.push(
				new CommandQuickPickItem(
					{
						label: `$(history) Show ${
							GitUri.relativeTo(workingUri || commit.uri, commit.repoPath) ? 'Previous ' : ''
						}File History`,
						description: `of ${commit.getFormattedPath()} from ${GlyphChars.Space}$(git-commit) ${
							commit.shortSha
						}`,
					},
					Commands.ShowQuickFileHistory,
					[commit.toGitUri(), fileHistoryCommandArgs],
				),
			);

			const commitDetailsCommandArgs: ShowQuickCommitDetailsCommandArgs = {
				commit: commit,
				sha: commit.sha,
				goBackCommand: currentCommand,
			};
			items.push(
				new CommandQuickPickItem(
					{
						label: '$(git-commit) Show Commit Details',
						description: `$(git-commit) ${commit.shortSha}`,
					},
					Commands.ShowQuickCommitDetails,
					[commit.toGitUri(), commitDetailsCommandArgs],
				),
			);
		}

		if (goBackCommand) {
			items.splice(0, 0, goBackCommand);
		}

		let previousCommand: KeyCommand | (() => Promise<KeyCommand>) | undefined = undefined;
		let nextCommand: KeyCommand | (() => Promise<KeyCommand>) | undefined = undefined;
		if (!stash) {
			previousCommand = async () => {
				const previousUri = await Container.git.getPreviousUri(commit.repoPath, uri, commit.sha);
				if (previousUri === undefined || previousUri.sha === undefined) return KeyNoopCommand;

				const previousCommandArgs: ShowQuickCommitFileDetailsCommandArgs = {
					// If we have the full file history, reuse it
					fileLog:
						fileLog !== undefined && !fileLog.hasMore && fileLog.sha === undefined ? fileLog : undefined,
					sha: previousUri.sha,
					goBackCommand: goBackCommand,
				};
				return new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [
					previousUri,
					previousCommandArgs,
				]);
			};

			nextCommand = async () => {
				const nextUri = await Container.git.getNextUri(commit.repoPath, uri, commit.sha);
				if (nextUri === undefined || nextUri.sha === undefined) return KeyNoopCommand;

				const nextCommandArgs: ShowQuickCommitFileDetailsCommandArgs = {
					// If we have the full file history, reuse it
					fileLog:
						fileLog !== undefined && !fileLog.hasMore && fileLog.sha === undefined ? fileLog : undefined,
					sha: nextUri.sha,
					goBackCommand: goBackCommand,
				};
				return new KeyCommandQuickPickItem(Commands.ShowQuickCommitFileDetails, [nextUri, nextCommandArgs]);
			};
		}

		const scope = await Container.keyboard.beginScope({
			'alt+left': goBackCommand,
			'alt+,': previousCommand,
			'alt+.': nextCommand,
		});

		const pick = await window.showQuickPick(items, {
			matchOnDescription: true,
			placeHolder: `${commit.getFormattedPath()} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${
				isUncommitted ? `Uncommitted ${GlyphChars.ArrowRightHollow} ` : ''
			}${commit.shortSha} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.author}, ${
				commit.formattedDate
			} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${commit.getShortMessage()}`,
			ignoreFocusOut: getQuickPickIgnoreFocusOut(),
			onDidSelectItem: (item: QuickPickItem) => {
				void scope.setKeyCommand('alt+right', item as KeyCommand);
			},
		});

		await scope.dispose();

		return pick;
	}
}
