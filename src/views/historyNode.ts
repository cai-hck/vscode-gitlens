'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../container';
import { ExplorerNode, ResourceType } from './explorerNode';
import { FileHistoryNode } from './fileHistoryNode';
import { GitExplorer } from './gitExplorer';
import { GitUri, Repository } from '../gitService';

export class HistoryNode extends ExplorerNode {

    constructor(
        uri: GitUri,
        private readonly repo: Repository,
        private readonly explorer: GitExplorer
    ) {
        super(uri);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        this.resetChildren();

        this.children = [
            new FileHistoryNode(this.uri, this.repo, this.explorer)
        ];
        return this.children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`${this.uri.getFormattedPath()}`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.History;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-history.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-history.svg')
        };

        return item;
    }
}