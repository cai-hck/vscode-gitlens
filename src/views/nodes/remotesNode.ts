'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { MessageNode } from './common';
import { Container } from '../../container';
import { Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { RemoteNode } from './remoteNode';
import { RemotesView } from '../remotesView';
import { RepositoriesView } from '../repositoriesView';
import { RepositoryNode } from './repositoryNode';
import { ContextValues, ViewNode } from './viewNode';

export class RemotesNode extends ViewNode<RemotesView | RepositoriesView> {
	static key = ':remotes';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	constructor(uri: GitUri, view: RemotesView | RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
		super(uri, view, parent);
	}

	get id(): string {
		return RemotesNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		const remotes = await this.repo.getRemotes({ sort: true });
		if (remotes === undefined || remotes.length === 0) {
			return [new MessageNode(this.view, this, 'No remotes could be found')];
		}

		return remotes.map(r => new RemoteNode(this.uri, this.view, this, r, this.repo));
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Remotes', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Remotes;

		item.iconPath = {
			dark: Container.context.asAbsolutePath('images/dark/icon-remote.svg'),
			light: Container.context.asAbsolutePath('images/light/icon-remote.svg'),
		};

		return item;
	}
}
