'use strict';
import { Disposable, TextEditor, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { UriComparer } from '../../comparers';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitCommitish, GitUri } from '../../git/gitService';
import { Logger } from '../../logger';
import { CommandQuickPickItem, ReferencesQuickPick } from '../../quickpicks';
import { debug, Functions, gate, log } from '../../system';
import { FileHistoryView } from '../fileHistoryView';
import { MessageNode } from './common';
import { FileHistoryNode } from './fileHistoryNode';
import { ResourceType, SubscribeableViewNode, unknownGitUri, ViewNode } from './viewNode';

export class FileHistoryTrackerNode extends SubscribeableViewNode<FileHistoryView> {
	private _baseRef: string | undefined;
	private _fileUri: GitUri | undefined;
	private _child: FileHistoryNode | undefined;

	constructor(view: FileHistoryView) {
		super(unknownGitUri, view);
	}

	dispose() {
		super.dispose();

		this.resetChild();
	}

	@debug()
	private resetChild() {
		if (this._child === undefined) return;

		this._child.dispose();
		this._child = undefined;
	}

	getChildren(): ViewNode[] {
		if (this._child === undefined) {
			if (this._fileUri === undefined && this.uri === unknownGitUri) {
				return [
					new MessageNode(
						this.view,
						this,
						'There are no editors open that can provide file history information.',
					),
				];
			}

			const uri = this._fileUri || this.uri;
			const commitish: GitCommitish = { ...uri, repoPath: uri.repoPath!, sha: this._baseRef || uri.sha };
			const fileUri = new GitUri(uri, commitish);
			this._child = new FileHistoryNode(fileUri, this.view, this);
		}

		return [this._child];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('File History', TreeItemCollapsibleState.Expanded);
		item.contextValue = ResourceType.ActiveFileHistory;

		void this.ensureSubscription();

		return item;
	}

	@gate()
	@log()
	async changeBase() {
		const pick = await new ReferencesQuickPick(this.uri.repoPath).show(
			`Change the file history base to${GlyphChars.Ellipsis}`,
			{
				allowEnteringRefs: true,
				checked: this._baseRef,
				checkmarks: true,
			},
		);
		if (pick === undefined || pick instanceof CommandQuickPickItem) return;

		this._baseRef = pick.current ? undefined : pick.ref;
		if (this._child === undefined) return;

		this._uri = unknownGitUri;
		await this.triggerChange();
	}

	@gate()
	@debug({
		exit: r => `returned ${r}`,
	})
	async refresh(reset: boolean = false) {
		const cc = Logger.getCorrelationContext();

		if (reset) {
			this._uri = unknownGitUri;
			this.resetChild();
		}

		const editor = window.activeTextEditor;
		if (editor == null || !Container.git.isTrackable(editor.document.uri)) {
			if (
				this.uri === unknownGitUri ||
				(Container.git.isTrackable(this.uri) &&
					window.visibleTextEditors.some(e => e.document && e.document.uri.path === this.uri.path))
			) {
				return true;
			}

			this._uri = unknownGitUri;
			this.resetChild();

			if (cc !== undefined) {
				cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
			}
			return false;
		}

		if (editor.document.uri.path === this.uri.path) {
			if (cc !== undefined) {
				cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
			}
			return true;
		}

		let gitUri = await GitUri.fromUri(editor.document.uri);

		let uri;
		if (gitUri.sha !== undefined) {
			// If we have a sha, normalize the history to the working file (so we get a full history all the time)
			const workingUri = await Container.git.getWorkingUri(gitUri.repoPath!, gitUri);
			if (workingUri !== undefined) {
				uri = workingUri;
			}
		}

		if (this.uri !== unknownGitUri && UriComparer.equals(uri || gitUri, this.uri)) {
			return true;
		}

		if (uri !== undefined) {
			gitUri = await GitUri.fromUri(uri);
		}

		this._uri = gitUri;
		this.resetChild();

		if (cc !== undefined) {
			cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
		}
		return false;
	}

	@log()
	setEditorFollowing(enabled: boolean) {
		if (enabled && this._fileUri !== undefined) {
			this._fileUri = undefined;
			this._baseRef = undefined;

			this._uri = unknownGitUri;
			// Don't need to call triggerChange here, since canSubscribe will do it
		}

		this.canSubscribe = enabled;
	}

	@log()
	async showHistoryForUri(uri: GitUri, baseRef?: string) {
		this._fileUri = uri;
		this._baseRef = baseRef;

		this._uri = unknownGitUri;
		await this.triggerChange();
	}

	@debug()
	protected subscribe() {
		return Disposable.from(
			window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this),
		);
	}

	@debug({ args: false })
	private onActiveEditorChanged(editor: TextEditor | undefined) {
		void this.triggerChange();
	}
}
