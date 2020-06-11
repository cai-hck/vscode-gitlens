'use strict';
import { StarredBranches, WorkspaceState } from '../../constants';
import { Container } from '../../container';
import { GitRemote, GitRevision } from '../git';
import { GitStatus } from './status';
import { Dates, memoize } from '../../system';
import { GitBranchReference, GitReference } from './models';
import { BranchSorting, configuration, DateStyle } from '../../configuration';

const whitespaceRegex = /\s/;

export const BranchDateFormatting = {
	dateFormat: undefined! as string | null,
	dateStyle: undefined! as DateStyle,

	reset: () => {
		BranchDateFormatting.dateFormat = configuration.get('defaultDateFormat');
		BranchDateFormatting.dateStyle = configuration.get('defaultDateStyle');
	},
};

export interface GitTrackingState {
	ahead: number;
	behind: number;
}

export class GitBranch implements GitBranchReference {
	static is(branch: any): branch is GitBranch {
		return branch instanceof GitBranch;
	}

	static isOfRefType(branch: GitReference | undefined) {
		return branch?.refType === 'branch';
	}

	static sort(branches: GitBranch[]) {
		const order = configuration.get('sortBranchesBy');

		switch (order) {
			case BranchSorting.DateAsc:
				return branches.sort(
					(a, b) =>
						(a.current ? -1 : 1) - (b.current ? -1 : 1) ||
						(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
						(b.remote ? -1 : 1) - (a.remote ? -1 : 1) ||
						(a.date === undefined ? -1 : a.date.getTime()) - (b.date === undefined ? -1 : b.date.getTime()),
				);
			case BranchSorting.DateDesc:
				return branches.sort(
					(a, b) =>
						(a.current ? -1 : 1) - (b.current ? -1 : 1) ||
						(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
						(b.remote ? -1 : 1) - (a.remote ? -1 : 1) ||
						(b.date === undefined ? -1 : b.date.getTime()) - (a.date === undefined ? -1 : a.date.getTime()),
				);
			case BranchSorting.NameAsc:
				return branches.sort(
					(a, b) =>
						(a.current ? -1 : 1) - (b.current ? -1 : 1) ||
						(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
						(a.name === 'master' ? -1 : 1) - (b.name === 'master' ? -1 : 1) ||
						(a.name === 'develop' ? -1 : 1) - (b.name === 'develop' ? -1 : 1) ||
						(b.remote ? -1 : 1) - (a.remote ? -1 : 1) ||
						b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }),
				);
			default:
				return branches.sort(
					(a, b) =>
						(a.current ? -1 : 1) - (b.current ? -1 : 1) ||
						(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
						(a.name === 'master' ? -1 : 1) - (b.name === 'master' ? -1 : 1) ||
						(a.name === 'develop' ? -1 : 1) - (b.name === 'develop' ? -1 : 1) ||
						(b.remote ? -1 : 1) - (a.remote ? -1 : 1) ||
						a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
				);
		}
	}

	readonly refType = 'branch';
	readonly detached: boolean;
	readonly id: string;
	readonly tracking?: string;
	readonly state: GitTrackingState;

	constructor(
		public readonly repoPath: string,
		public readonly name: string,
		public readonly remote: boolean,
		public readonly current: boolean,
		public readonly date: Date | undefined,
		public readonly sha?: string,
		tracking?: string,
		ahead: number = 0,
		behind: number = 0,
		detached: boolean = false,
	) {
		this.id = `${repoPath}|${remote ? 'remotes/' : 'heads/'}${name}`;

		this.detached = detached || (this.current ? GitBranch.isDetached(name) : false);
		if (this.detached) {
			this.name = GitBranch.formatDetached(this.sha!);
		}

		this.tracking = tracking == null || tracking.length === 0 ? undefined : tracking;
		this.state = {
			ahead: ahead,
			behind: behind,
		};
	}

	get formattedDate(): string {
		return BranchDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(BranchDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	get ref() {
		return this.detached ? this.sha! : this.name;
	}

	@memoize()
	private get dateFormatter(): Dates.DateFormatter | undefined {
		return this.date === undefined ? undefined : Dates.getFormatter(this.date);
	}

	@memoize<GitBranch['formatDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.dateFormatter === undefined ? '' : this.dateFormatter.format(format);
	}

	formatDateFromNow() {
		return this.dateFormatter === undefined ? '' : this.dateFormatter.fromNow();
	}

	@memoize()
	getBasename(): string {
		const name = this.getNameWithoutRemote();
		const index = name.lastIndexOf('/');
		return index !== -1 ? name.substring(index + 1) : name;
	}

	@memoize()
	getNameWithoutRemote(): string {
		return this.remote ? this.name.substring(this.name.indexOf('/') + 1) : this.name;
	}

	@memoize()
	async getRemote(): Promise<GitRemote | undefined> {
		const remoteName = this.getRemoteName();
		if (remoteName === undefined) return undefined;

		const remotes = await Container.git.getRemotes(this.repoPath);
		if (remotes.length === 0) return undefined;

		return remotes.find(r => r.name === remoteName);
	}

	@memoize()
	getRemoteName(): string | undefined {
		if (this.remote) return GitBranch.getRemote(this.name);
		if (this.tracking !== undefined) return GitBranch.getRemote(this.tracking);

		return undefined;
	}

	getTrackingStatus(options?: {
		empty?: string;
		expand?: boolean;
		prefix?: string;
		separator?: string;
		suffix?: string;
	}): string {
		return GitStatus.getUpstreamStatus(this.tracking, this.state, options);
	}

	get starred() {
		const starred = Container.context.workspaceState.get<StarredBranches>(WorkspaceState.StarredBranches);
		return starred !== undefined && starred[this.id] === true;
	}

	star() {
		return this.updateStarred(true);
	}

	unstar() {
		return this.updateStarred(false);
	}

	private async updateStarred(star: boolean) {
		let starred = Container.context.workspaceState.get<StarredBranches>(WorkspaceState.StarredBranches);
		if (starred === undefined) {
			starred = Object.create(null) as StarredBranches;
		}

		if (star) {
			starred[this.id] = true;
		} else {
			const { [this.id]: _, ...rest } = starred;
			starred = rest;
		}
		await Container.context.workspaceState.update(WorkspaceState.StarredBranches, starred);
	}

	static formatDetached(sha: string): string {
		return `(${GitRevision.shorten(sha)}...)`;
	}

	static getRemote(name: string): string {
		return name.substring(0, name.indexOf('/'));
	}

	static isDetached(name: string): boolean {
		// If there is whitespace in the name assume this is not a valid branch name
		// Deals with detached HEAD states
		return whitespaceRegex.test(name) || name.includes('(detached)');
	}
}
