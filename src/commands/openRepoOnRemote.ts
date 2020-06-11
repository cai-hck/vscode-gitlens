'use strict';
import { TextEditor, Uri, window } from 'vscode';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	executeCommand,
	getCommandUri,
	getRepoPathOrActiveOrPrompt,
	isCommandViewContextWithRemote,
} from './common';
import { RemoteResourceType } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenRepoOnRemoteCommandArgs {
	remote?: string;
}

@command()
export class OpenRepoOnRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.OpenRepoInRemote);
	}

	protected preExecute(context: CommandContext, args?: OpenRepoOnRemoteCommandArgs) {
		if (isCommandViewContextWithRemote(context)) {
			args = { ...args };
			args.remote = context.node.remote.name;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenRepoOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri && (await GitUri.fromUri(uri));

		const repoPath = await getRepoPathOrActiveOrPrompt(gitUri, editor, 'Choose which repository to open on remote');
		if (!repoPath) return;

		try {
			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				resource: {
					type: RemoteResourceType.Repo,
				},
				repoPath: repoPath,
				remote: args?.remote,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenRepoOnRemoteCommand');
			void window.showErrorMessage(
				'Unable to open repository on remote provider. See output channel for more details',
			);
		}
	}
}
