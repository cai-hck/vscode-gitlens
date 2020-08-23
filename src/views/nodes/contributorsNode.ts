'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitContributor, Repository } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { RepositoriesView } from '../repositoriesView';
import { MessageNode } from './common';
import { ContributorNode } from './contributorNode';
import { ContextValues, ViewNode } from './viewNode';
import { Container } from '../../container';
import { RepositoryNode } from './repositoryNode';
import { debug, timeout } from '../../system';

export class ContributorsNode extends ViewNode<RepositoriesView> {
	static key = ':contributors';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	constructor(uri: GitUri, view: RepositoriesView, parent: ViewNode, public readonly repo: Repository) {
		super(uri, view, parent);
	}

	get id(): string {
		return ContributorsNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		const contributors = await this.repo.getContributors();
		if (contributors.length === 0) return [new MessageNode(this.view, this, 'No contributors could be found.')];

		GitContributor.sort(contributors);
		const presenceMap = await this.maybeGetPresenceMap(contributors).catch(() => undefined);

		const children = contributors.map(c => new ContributorNode(this.uri, this.view, this, c, presenceMap));
		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Contributors', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Contributors;
		item.iconPath = new ThemeIcon('organization');
		return item;
	}

	@debug({ args: false })
	@timeout(250)
	private async maybeGetPresenceMap(contributors: GitContributor[]) {
		// Only get presence for the current user, because it is far too slow otherwise
		const email = contributors.find(c => c.current)?.email;
		if (email == null) return undefined;

		return Container.vsls.getContactsPresence([email]);
	}
}
