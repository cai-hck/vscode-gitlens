'use strict';
import { commands, Disposable, TextEditor, TextEditorEdit, Uri, window, workspace } from 'vscode';
import { BuiltInCommands } from '../constants';

export type Commands = 'gitlens.closeUnchangedFiles' | 'gitlens.copyMessageToClipboard' | 'gitlens.copyShaToClipboard' |
    'gitlens.diffDirectory' | 'gitlens.diffWithBranch' | 'gitlens.diffWithNext' | 'gitlens.diffWithPrevious' | 'gitlens.diffLineWithPrevious' | 'gitlens.diffWithWorking' | 'gitlens.diffLineWithWorking' |
    'gitlens.openChangedFiles' | 'gitlens.openCommitInRemote' | 'gitlens.openFileInRemote' | 'gitlens.openInRemote' |
    'gitlens.showBlame' | 'gitlens.showBlameHistory' | 'gitlens.showFileHistory' |
    'gitlens.showLastQuickPick' | 'gitlens.showQuickBranchHistory' |
    'gitlens.showQuickCommitDetails' | 'gitlens.showQuickCommitFileDetails' |
    'gitlens.showQuickFileHistory' | 'gitlens.showQuickRepoHistory' |
    'gitlens.showQuickRepoStatus' |
    'gitlens.toggleBlame' | 'gitlens.toggleCodeLens';
export const Commands = {
    CloseUnchangedFiles: 'gitlens.closeUnchangedFiles' as Commands,
    CopyMessageToClipboard: 'gitlens.copyMessageToClipboard' as Commands,
    CopyShaToClipboard: 'gitlens.copyShaToClipboard' as Commands,
    DiffDirectory: 'gitlens.diffDirectory' as Commands,
    DiffWithBranch: 'gitlens.diffWithBranch' as Commands,
    DiffWithNext: 'gitlens.diffWithNext' as Commands,
    DiffWithPrevious: 'gitlens.diffWithPrevious' as Commands,
    DiffLineWithPrevious: 'gitlens.diffLineWithPrevious' as Commands,
    DiffWithWorking: 'gitlens.diffWithWorking' as Commands,
    DiffLineWithWorking: 'gitlens.diffLineWithWorking' as Commands,
    OpenChangedFiles: 'gitlens.openChangedFiles' as Commands,
    OpenCommitInRemote: 'gitlens.openCommitInRemote' as Commands,
    OpenFileInRemote: 'gitlens.openFileInRemote' as Commands,
    OpenInRemote: 'gitlens.openInRemote' as Commands,
    ShowBlame: 'gitlens.showBlame' as Commands,
    ShowBlameHistory: 'gitlens.showBlameHistory' as Commands,
    ShowFileHistory: 'gitlens.showFileHistory' as Commands,
    ShowLastQuickPick: 'gitlens.showLastQuickPick' as Commands,
    ShowQuickCommitDetails: 'gitlens.showQuickCommitDetails' as Commands,
    ShowQuickCommitFileDetails: 'gitlens.showQuickCommitFileDetails' as Commands,
    ShowQuickFileHistory: 'gitlens.showQuickFileHistory' as Commands,
    ShowQuickBranchHistory: 'gitlens.showQuickBranchHistory' as Commands,
    ShowQuickCurrentBranchHistory: 'gitlens.showQuickRepoHistory' as Commands,
    ShowQuickRepoStatus: 'gitlens.showQuickRepoStatus' as Commands,
    ToggleBlame: 'gitlens.toggleBlame' as Commands,
    ToggleCodeLens: 'gitlens.toggleCodeLens' as Commands
};

export abstract class Command extends Disposable {

    private _disposable: Disposable;

    constructor(protected command: Commands) {
        super(() => this.dispose());
        this._disposable = commands.registerCommand(command, this._execute, this);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    protected _execute(...args: any[]): any {
        return this.execute(...args);
    }

    abstract execute(...args: any[]): any;
}

export abstract class EditorCommand extends Disposable {

    private _disposable: Disposable;

    constructor(public readonly command: Commands) {
        super(() => this.dispose());
        this._disposable = commands.registerTextEditorCommand(command, this._execute, this);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    private _execute(editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any {
        return this.execute(editor, edit, ...args);
    }

    abstract execute(editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any;
}

export abstract class ActiveEditorCommand extends Command {

    constructor(public readonly command: Commands) {
        super(command);
    }

    protected _execute(...args: any[]): any {
        return super._execute(window.activeTextEditor, ...args);
    }

    abstract execute(editor: TextEditor, ...args: any[]): any;
}

let lastCommand: { command: string, args: any[] } = undefined;
export function getLastCommand() {
    return lastCommand;
}

export abstract class ActiveEditorCachedCommand extends ActiveEditorCommand {

    constructor(public readonly command: Commands) {
        super(command);
    }

    protected _execute(...args: any[]): any {
        lastCommand = {
            command: this.command,
            args: args
        };
        return super._execute(...args);
    }

    abstract execute(editor: TextEditor, ...args: any[]): any;
}

export async function openEditor(uri: Uri, pinned: boolean = false) {
    try {
        if (!pinned) return await commands.executeCommand(BuiltInCommands.Open, uri);

        const document = await workspace.openTextDocument(uri);
        return window.showTextDocument(document, (window.activeTextEditor && window.activeTextEditor.viewColumn) || 1, true);
    }
    catch (ex) {
        return undefined;
    }
}