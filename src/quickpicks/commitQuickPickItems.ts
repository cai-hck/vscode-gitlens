'use strict';
import * as paths from 'path';
import { QuickPickItem, window } from 'vscode';
import { Commands, GitActions, OpenChangedFilesCommandArgs } from '../commands';
import { CommitFormatter, GitFile, GitLogCommit, GitStatusFile } from '../git/git';
import { Keys } from '../keyboard';
import { CommandQuickPickItem } from './quickPicksItems';
import { Strings } from '../system';

export class CommitFilesQuickPickItem extends CommandQuickPickItem {
	constructor(readonly commit: GitLogCommit, picked: boolean = true) {
		super(
			{
				label: commit.getShortMessage(),
				// eslint-disable-next-line no-template-curly-in-string
				description: CommitFormatter.fromTemplate('${author}, ${ago}  $(git-commit)  ${id}', commit),
				detail: `$(files) ${commit.getFormattedDiffStatus({ expand: true, separator: ', ' })}`,
				picked: picked,
			},
			undefined,
			undefined,
			{ suppressKeyPress: true },
		);
	}

	get sha(): string {
		return this.commit.sha;
	}
}

export class CommitFileQuickPickItem extends CommandQuickPickItem {
	constructor(readonly commit: GitLogCommit, readonly file: GitFile, picked?: boolean) {
		super({
			label: `${Strings.pad(GitFile.getStatusCodicon(file.status), 0, 2)}${paths.basename(file.fileName)}`,
			description: GitFile.getFormattedDirectory(file, true),
			picked: picked,
		});

		// TODO@eamodio - add line diff details
		// this.detail = this.commit.getFormattedDiffStatus({ expand: true });
	}

	get sha(): string {
		return this.commit.sha;
	}

	execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openChanges(this.file, this.commit, options);
		// const fileCommit = this.commit.toFileCommit(this.file)!;

		// if (fileCommit.previousSha === undefined) {
		// 	void (await findOrOpenEditor(
		// 		GitUri.toRevisionUri(fileCommit.sha, this.file, fileCommit.repoPath),
		// 		options,
		// 	));

		// 	return;
		// }

		// const commandArgs: DiffWithPreviousCommandArgs = {
		// 	commit: fileCommit,
		// 	showOptions: options,
		// };
		// void (await commands.executeCommand(Commands.DiffWithPrevious, fileCommit.toGitUri(), commandArgs));
	}
}

export class CommitCopyIdQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item || '$(clippy) Copy Commit ID');
	}

	execute(): Promise<void> {
		return GitActions.Commit.copyIdToClipboard(this.commit);
	}

	async onDidPressKey(key: Keys): Promise<void> {
		await super.onDidPressKey(key);
		window.showInformationMessage('Commit ID copied to the clipboard');
	}
}

export class CommitCopyMessageQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item || '$(clippy) Copy Message');
	}

	execute(): Promise<void> {
		return GitActions.Commit.copyMessageToClipboard(this.commit);
	}

	async onDidPressKey(key: Keys): Promise<void> {
		await super.onDidPressKey(key);
		window.showInformationMessage(`${this.commit.isStash ? 'Stash' : 'Commit'} Message copied to the clipboard`);
	}
}

export class CommitOpenAllChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open All Changes');
	}

	execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openAllChanges(this.commit, options);
	}
}

export class CommitOpenAllChangesWithDiffToolCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open All Changes (with difftool)');
	}

	execute(): Promise<void> {
		return GitActions.Commit.openAllChangesWithDiffTool(this.commit);
	}
}

export class CommitOpenAllChangesWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open All Changes with Working Tree');
	}

	execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openAllChangesWithWorking(this.commit, options);
	}
}

export class CommitOpenChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Changes');
	}

	execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openChanges(this.file, this.commit, options);
	}
}

export class CommitOpenChangesWithDiffToolCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Changes (with difftool)');
	}

	execute(): Promise<void> {
		return GitActions.Commit.openChangesWithDiffTool(this.file, this.commit);
	}
}

export class CommitOpenChangesWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item ?? '$(git-compare) Open Changes with Working File');
	}

	execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openChangesWithWorking(this.file, this.commit, options);
	}
}

export class CommitOpenDirectoryCompareCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item || '$(git-compare) Open Directory Compare');
	}

	execute(): Promise<void> {
		return GitActions.Commit.openDirectoryCompare(this.commit);
	}
}

export class CommitOpenDirectoryCompareWithWorkingCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item || '$(git-compare) Open Directory Compare with Working Tree');
	}

	execute(): Promise<void> {
		return GitActions.Commit.openDirectoryCompareWithWorking(this.commit);
	}
}

export class CommitOpenFilesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(files) Open Files');
	}

	execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFiles(this.commit, options);
	}
}

export class CommitOpenFileCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item || '$(file) Open File');
	}

	execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFile(this.file, this.commit, options);
	}
}

export class CommitOpenRevisionsCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, item?: QuickPickItem) {
		super(item ?? '$(files) Open Files at Revision');
	}

	execute(options: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFilesAtRevision(this.commit, options);
	}
}

export class CommitOpenRevisionCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item || '$(file) Open File at Revision');
	}

	execute(options?: { preserveFocus?: boolean; preview?: boolean }): Promise<void> {
		return GitActions.Commit.openFileAtRevision(this.file, this.commit, options);
	}
}

export class CommitApplyFileChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(item || 'Apply Changes');
	}

	async execute(): Promise<void> {
		return GitActions.Commit.applyChanges(this.file, this.commit);
	}
}

export class CommitRestoreFileChangesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(private readonly commit: GitLogCommit, private readonly file: string | GitFile, item?: QuickPickItem) {
		super(
			item || {
				label: 'Restore',
				description: 'aka checkout',
			},
		);
	}

	execute(): Promise<void> {
		return GitActions.Commit.restoreFile(this.file, this.commit);
	}
}

export class OpenChangedFilesCommandQuickPickItem extends CommandQuickPickItem {
	constructor(files: GitStatusFile[], item?: QuickPickItem) {
		const commandArgs: OpenChangedFilesCommandArgs = {
			uris: files.map(f => f.uri),
		};

		super(item ?? '$(files) Open All Changed Files', Commands.OpenChangedFiles, [commandArgs]);
	}
}
