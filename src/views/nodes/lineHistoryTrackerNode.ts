'use strict';
import { Selection, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { MessageNode } from './common';
import { UriComparer } from '../../comparers';
import { Container } from '../../container';
import { GitReference } from '../../git/git';
import { GitCommitish, GitUri } from '../../git/gitUri';
import { LineHistoryView } from '../lineHistoryView';
import { LineHistoryNode } from './lineHistoryNode';
import { Logger } from '../../logger';
import { ReferencePicker } from '../../quickpicks';
import { debug, Functions, gate, log } from '../../system';
import { LinesChangeEvent } from '../../trackers/gitLineTracker';
import { ResourceType, SubscribeableViewNode, unknownGitUri, ViewNode } from './viewNode';

export class LineHistoryTrackerNode extends SubscribeableViewNode<LineHistoryView> {
	private _base: string | undefined;
	private _child: LineHistoryNode | undefined;
	private _editorContents: string | undefined;
	private _selection: Selection | undefined;

	constructor(view: LineHistoryView) {
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
			if (this.uri === unknownGitUri) {
				return [
					new MessageNode(
						this.view,
						this,
						'There are no editors open that can provide line history information.',
					),
				];
			}

			const commitish: GitCommitish = {
				...this.uri,
				repoPath: this.uri.repoPath!,
				sha: this.uri.sha || this._base,
			};
			const fileUri = new GitUri(this.uri, commitish);
			this._child = new LineHistoryNode(fileUri, this.view, this, this._selection!, this._editorContents);
		}

		return [this._child];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Line History', TreeItemCollapsibleState.Expanded);
		item.contextValue = ResourceType.ActiveLineHistory;

		void this.ensureSubscription();

		return item;
	}

	@gate()
	@log()
	async changeBase() {
		const pick = await ReferencePicker.show(
			this.uri.repoPath!,
			'Change Line History Base',
			'Choose a reference to set as the new base',
			{
				allowEnteringRefs: true,
				picked: this._base,
				// checkmarks: true,
			},
		);
		if (pick == null) return;

		if (GitReference.isBranch(pick)) {
			const branch = await Container.git.getBranch(this.uri.repoPath);
			this._base = branch?.name === pick.name ? undefined : pick.ref;
		} else {
			this._base = pick.ref;
		}
		if (this._child == null) return;

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
			this._editorContents = undefined;
			this._selection = undefined;
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
			this._editorContents = undefined;
			this._selection = undefined;
			this.resetChild();

			if (cc !== undefined) {
				cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
			}
			return false;
		}

		if (
			editor.document.uri.path === this.uri.path &&
			this._selection !== undefined &&
			editor.selection.isEqual(this._selection)
		) {
			if (cc !== undefined) {
				cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
			}
			return true;
		}

		const gitUri = await GitUri.fromUri(editor.document.uri);

		if (
			this.uri !== unknownGitUri &&
			UriComparer.equals(gitUri, this.uri) &&
			this._selection !== undefined &&
			editor.selection.isEqual(this._selection)
		) {
			return true;
		}

		this._uri = gitUri;
		this._editorContents = editor.document.isDirty ? editor.document.getText() : undefined;
		this._selection = editor.selection;
		this.resetChild();

		if (cc !== undefined) {
			cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
		}
		return false;
	}

	@log()
	setEditorFollowing(enabled: boolean) {
		this.canSubscribe = enabled;
	}

	@debug()
	protected subscribe() {
		if (Container.lineTracker.isSubscribed(this)) return undefined;

		const onActiveLinesChanged = Functions.debounce(this.onActiveLinesChanged.bind(this), 250);

		return Container.lineTracker.start(
			this,
			Container.lineTracker.onDidChangeActiveLines((e: LinesChangeEvent) => {
				if (e.pending) return;

				onActiveLinesChanged(e);
			}),
		);
	}

	@debug({
		args: {
			0: (e: LinesChangeEvent) =>
				`editor=${e.editor?.document.uri.toString(true)}, lines=${e.lines?.join(',')}, pending=${Boolean(
					e.pending,
				)}, reason=${e.reason}`,
		},
	})
	private onActiveLinesChanged(e: LinesChangeEvent) {
		void this.triggerChange();
	}
}
