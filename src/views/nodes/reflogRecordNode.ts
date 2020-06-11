'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitLog, GitReflogRecord } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { debug, gate, Iterables } from '../../system';
import { ViewWithFiles } from '../viewBase';
import { CommitNode } from './commitNode';
import { MessageNode, ShowMoreNode } from './common';
import { PageableViewNode, ResourceType, ViewNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';

export class ReflogRecordNode extends ViewNode<ViewWithFiles> implements PageableViewNode {
	static key = ':reflog-record';
	static getId(
		repoPath: string,
		sha: string,
		selector: string,
		command: string,
		commandArgs: string | undefined,
		date: Date,
	): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${sha}|${selector}|${command}|${
			commandArgs || ''
		}|${date.getTime()})`;
	}

	constructor(view: ViewWithFiles, parent: ViewNode, public readonly record: GitReflogRecord) {
		super(GitUri.fromRepoPath(record.repoPath), view, parent);
	}

	get id(): string {
		return ReflogRecordNode.getId(
			this.uri.repoPath!,
			this.record.sha,
			this.record.selector,
			this.record.command,
			this.record.commandArgs,
			this.record.date,
		);
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log === undefined) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const children: (CommitNode | ShowMoreNode)[] = [
			...Iterables.map(log.commits.values(), c => new CommitNode(this.view, this, c)),
		];

		if (log.hasMore) {
			children.push(new ShowMoreNode(this.view, this, children[children.length - 1]));
		}
		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			`${this.record.command}${this.record.commandArgs ? ` ${this.record.commandArgs}` : ''}`,
			TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.description = `${
			this.record.HEAD.length === 0
				? ''
				: `${this.record.HEAD} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} `
		}${this.record.formattedDate}`;
		item.contextValue = ResourceType.ReflogRecord;
		item.tooltip = `${this.record.HEAD.length === 0 ? '' : `${this.record.HEAD}\n`}${this.record.command}${
			this.record.commandArgs ? ` ${this.record.commandArgs}` : ''
		}${
			this.record.details ? ` (${this.record.details})` : ''
		}\n${this.record.formatDateFromNow()} (${this.record.formatDate()})\n${this.record.previousShortSha} ${
			GlyphChars.Space
		}${GlyphChars.ArrowRight}${GlyphChars.Space} ${this.record.shortSha}`;

		return item;
	}

	@gate()
	@debug()
	refresh(reset?: boolean) {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log === undefined) {
			const range = `${this.record.previousSha}..${this.record.sha}`;
			this._log = await Container.git.getLog(this.uri.repoPath!, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				ref: range,
			});
		}

		return this._log;
	}

	get hasMore() {
		return this._log?.hasMore ?? true;
	}

	limit: number | undefined = this.view.getNodeLastKnownLimit(this);
	async showMore(limit?: number | { until?: any }) {
		let log = await this.getLog();
		if (log === undefined || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;
		this.triggerChange(false);
	}
}
