'use strict';
import { TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { Arrays } from '../system';
import { ActiveEditorCommand, Commands, getCommandUri, getRepoPathOrActiveOrPrompt, openEditor } from './common';

export interface OpenChangedFilesCommandArgs {
    uris?: Uri[];
}

export class OpenChangedFilesCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.OpenChangedFiles);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: OpenChangedFilesCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        try {
            if (args.uris === undefined) {
                args = { ...args };

                const repoPath = await getRepoPathOrActiveOrPrompt(
                    uri,
                    editor,
                    `Open changed files in which repository${GlyphChars.Ellipsis}`
                );
                if (!repoPath) return undefined;

                const status = await Container.git.getStatusForRepo(repoPath);
                if (status === undefined) return window.showWarningMessage(`Unable to open changed files`);

                args.uris = Arrays.filterMap(status.files, f => (f.status !== 'D' ? f.uri : undefined));
            }

            for (const uri of args.uris) {
                await openEditor(uri, { preserveFocus: true, preview: false } as TextDocumentShowOptions);
            }

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'OpenChangedFilesCommand');
            return Messages.showGenericErrorMessage('Unable to open changed files');
        }
    }
}
