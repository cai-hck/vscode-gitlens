'use strict';
import { Iterables } from '../system';
import { QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard } from '../commands';
import { GitCommit, GitLogCommit, GitProvider, GitUri } from '../gitProvider';
import { CommitWithFileStatusQuickPickItem } from './gitQuickPicks';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, OpenFileCommandQuickPickItem, OpenFilesCommandQuickPickItem } from './quickPicks';
import * as moment from 'moment';
import * as path from 'path';

export { CommandQuickPickItem, CommitWithFileStatusQuickPickItem };

export class OpenCommitFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(commit: GitCommit, item?: QuickPickItem) {
        const uri = GitProvider.toGitContentUri(commit);
        super(uri, item || {
            label: `$(file-symlink-file) Open File`,
            description: `\u00a0 \u2014 \u00a0\u00a0 as of \u00a0 $(git-commit) \u00a0 ${commit.sha} \u00a0\u2022\u00a0 ${commit.getFormattedPath()}`
        });
    }
}

export class OpenCommitWorkingTreeFileCommandQuickPickItem extends OpenFileCommandQuickPickItem {

    constructor(commit: GitCommit, item?: QuickPickItem) {
        const uri = Uri.file(path.resolve(commit.repoPath, commit.fileName));
        super(uri, item || {
            label: `$(file-symlink-file) Open Working File`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.getFormattedPath()}`
        });
    }
}

export class OpenCommitFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(commit: GitLogCommit, item?: QuickPickItem) {
        const repoPath = commit.repoPath;
        const uris = commit.fileStatuses.map(_ => GitProvider.toGitContentUri(commit.sha, _.fileName, repoPath, commit.originalFileName));
        super(uris, item || {
            label: `$(file-symlink-file) Open Files`,
            description: `\u00a0 \u2014 \u00a0\u00a0 as of \u00a0 $(git-commit) \u00a0 ${commit.sha}`
            //detail: `Opens all of the changed files in $(git-commit) ${commit.sha}`
        });
    }
}

export class OpenCommitWorkingTreeFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(commit: GitLogCommit, versioned: boolean = false, item?: QuickPickItem) {
        const repoPath = commit.repoPath;
        const uris = commit.fileStatuses.map(_ => Uri.file(path.resolve(repoPath, _.fileName)));
        super(uris, item || {
            label: `$(file-symlink-file) Open Working Files`,
            description: undefined
            //detail: `Opens all of the changed file in the working tree`
        });
    }
}

export class CommitDetailsQuickPick {

    static async show(commit: GitLogCommit, uri: Uri, goBackCommand?: CommandQuickPickItem): Promise<CommitWithFileStatusQuickPickItem | CommandQuickPickItem | undefined> {
        const items: (CommitWithFileStatusQuickPickItem | CommandQuickPickItem)[] = commit.fileStatuses.map(fs => new CommitWithFileStatusQuickPickItem(commit, fs.fileName, fs.status));

        items.splice(0, 0, new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Sha to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.sha}`
        }, Commands.CopyShaToClipboard, [uri, commit.sha]));

        items.splice(1, 0, new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Message to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.message}`
        }, Commands.CopyMessageToClipboard, [uri, commit.sha, commit.message]));

        items.splice(2, 0, new OpenCommitWorkingTreeFilesCommandQuickPickItem(commit));
        items.splice(3, 0, new OpenCommitFilesCommandQuickPickItem(commit));

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        await Keyboard.instance.enterScope(['left', goBackCommand]);

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${commit.sha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()} \u2022 ${commit.message}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                Keyboard.instance.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await Keyboard.instance.exitScope();

        return pick;
    }
}

export class CommitFileDetailsQuickPick {

    static async show(git: GitProvider, commit: GitCommit, workingFileName: string, uri: Uri, currentCommand?: CommandQuickPickItem, goBackCommand?: CommandQuickPickItem, options: { showFileHistory?: boolean } = {}): Promise<CommandQuickPickItem | undefined> {
        const items: CommandQuickPickItem[] = [];

        const workingName = (workingFileName && path.basename(workingFileName)) || path.basename(commit.fileName);

        const isUncommitted = commit.isUncommitted;
        if (isUncommitted) {
            // Since we can't trust the previous sha on an uncommitted commit, find the last commit for this file
            const log = await git.getLogForFile(commit.uri.fsPath, undefined, undefined, undefined, 2);
            if (!log) return undefined;

            commit = Iterables.first(log.commits.values());
        }

        if (commit.previousSha) {
            items.push(new CommandQuickPickItem({
                label: `$(git-compare) Compare with Previous Commit`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.previousSha} \u00a0 $(git-compare) \u00a0 $(git-commit) ${commit.sha}`
            }, Commands.DiffWithPrevious, [commit.uri, commit]));
        }

        items.push(new CommandQuickPickItem({
            label: `$(git-compare) Compare with Working Tree`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.sha} \u00a0 $(git-compare) \u00a0 $(file-text) ${workingName}`
        }, Commands.DiffWithWorking, [uri, commit]));

        items.push(new CommandQuickPickItem({
            label: `$(diff) Show Changed Files`,
            description: undefined, //`\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.sha}`,
            detail: `Shows all of the changed files in commit $(git-commit) ${commit.sha}`
        }, Commands.ShowQuickCommitDetails, [new GitUri(commit.uri, commit), commit.sha, undefined, currentCommand]));

        items.push(new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Sha to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.sha}`
        }, Commands.CopyShaToClipboard, [uri, commit.sha]));

        items.push(new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Message to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.message}`
        }, Commands.CopyMessageToClipboard, [uri, commit.sha, commit.message]));

        items.push(new OpenCommitWorkingTreeFileCommandQuickPickItem(commit));
        items.push(new OpenCommitFileCommandQuickPickItem(commit));

        if (options.showFileHistory) {
            if (workingFileName) {
                items.push(new CommandQuickPickItem({
                    label: `$(history) Show File History`,
                    description: undefined, //`\u00a0 \u2014 \u00a0\u00a0 ${path.basename(commit.fileName)}`,
                    detail: `Shows the commit history of the file, starting at the most recent commit`
                }, Commands.ShowQuickFileHistory, [commit.uri, undefined, undefined, currentCommand]));
            }

            items.push(new CommandQuickPickItem({
                label: `$(history) Show Previous File History`,
                description: undefined, //`\u00a0 \u2014 \u00a0\u00a0 ${path.basename(commit.fileName)}`,
                detail: `Shows the previous commit history of the file, starting at $(git-commit) ${commit.sha}`
            }, Commands.ShowQuickFileHistory, [new GitUri(commit.uri, commit), undefined, undefined, currentCommand]));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        await Keyboard.instance.enterScope(['left', goBackCommand]);

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: `${commit.getFormattedPath()} \u2022 ${isUncommitted ? 'Uncommitted \u21E8 ' : '' }${commit.sha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()} \u2022 ${commit.message}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                Keyboard.instance.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await Keyboard.instance.exitScope();

        return pick;
    }
}