'use strict';
import { QuickInputButton, QuickPick } from 'vscode';
import { Commands } from './common';
import { configuration } from '../configuration';
import { Container } from '../container';
import { GlyphChars } from '../constants';
import {
	GitBranch,
	GitBranchReference,
	GitContributor,
	GitLog,
	GitLogCommit,
	GitReference,
	GitRemote,
	GitRevision,
	GitRevisionReference,
	GitStash,
	GitStashCommit,
	GitStatus,
	GitTag,
	GitTagReference,
	RemoteProvider,
	RemoteResourceType,
	Repository,
	SearchPattern,
} from '../git/git';
import { GitService } from '../git/gitService';
import {
	PartialStepState,
	QuickCommand,
	QuickCommandButtons,
	QuickPickStep,
	SelectableQuickInputButton,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from './quickCommand';
import {
	BranchQuickPickItem,
	CommandQuickPickItem,
	CommitApplyFileChangesCommandQuickPickItem,
	CommitCopyIdQuickPickItem,
	CommitCopyMessageQuickPickItem,
	CommitFileQuickPickItem,
	CommitFilesQuickPickItem,
	CommitOpenAllChangesCommandQuickPickItem,
	CommitOpenAllChangesWithDiffToolCommandQuickPickItem,
	CommitOpenAllChangesWithWorkingCommandQuickPickItem,
	CommitOpenChangesCommandQuickPickItem,
	CommitOpenChangesWithDiffToolCommandQuickPickItem,
	CommitOpenChangesWithWorkingCommandQuickPickItem,
	CommitOpenDirectoryCompareCommandQuickPickItem,
	CommitOpenDirectoryCompareWithWorkingCommandQuickPickItem,
	CommitOpenFileCommandQuickPickItem,
	CommitOpenFilesCommandQuickPickItem,
	CommitOpenRevisionCommandQuickPickItem,
	CommitOpenRevisionsCommandQuickPickItem,
	CommitQuickPickItem,
	CommitRestoreFileChangesCommandQuickPickItem,
	ContributorQuickPickItem,
	CopyRemoteResourceCommandQuickPickItem,
	Directive,
	DirectiveQuickPickItem,
	GitCommandQuickPickItem,
	OpenChangedFilesCommandQuickPickItem,
	OpenInSearchCommitsViewQuickPickItem,
	OpenRemoteResourceCommandQuickPickItem,
	ReferencesQuickPickItem,
	RepositoryQuickPickItem,
	RevealInRepositoriesViewQuickPickItem,
	TagQuickPickItem,
} from '../quickpicks';
import { Arrays, Iterables, Strings } from '../system';
import { GitUri } from '../git/gitUri';

export function appendReposToTitle<
	State extends { repo: Repository } | { repos: Repository[] },
	Context extends { repos: Repository[] }
>(title: string, state: State, context: Context, additionalContext?: string) {
	if (context.repos.length === 1) return `${title}${additionalContext ?? ''}`;

	if ((state as { repo: Repository }).repo != null) {
		return `${title}${Strings.pad(GlyphChars.Dot, 2, 2)}${(state as { repo: Repository }).repo.formattedName}`;
	}

	return `${title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
		(state as { repos: Repository[] }).repos.length === 1
			? `${(state as { repos: Repository[] }).repos[0].formattedName}${additionalContext ?? ''}`
			: `${(state as { repos: Repository[] }).repos.length} repositories`
	}`;
}

export async function getBranches(
	repos: Repository | Repository[],
	options: { filterBranches?: (b: GitBranch) => boolean; picked?: string | string[] } = {},
): Promise<BranchQuickPickItem[]> {
	return getBranchesAndOrTags(repos, ['branches'], options) as Promise<BranchQuickPickItem[]>;
}

export async function getTags(
	repos: Repository | Repository[],
	options: { filterTags?: (t: GitTag) => boolean; picked?: string | string[] } = {},
): Promise<TagQuickPickItem[]> {
	return getBranchesAndOrTags(repos, ['tags'], options) as Promise<TagQuickPickItem[]>;
}

export async function getBranchesAndOrTags(
	repos: Repository | Repository[],
	include: ('tags' | 'branches')[],
	{
		filterBranches,
		filterTags,
		picked,
	}: {
		filterBranches?: (b: GitBranch) => boolean;
		filterTags?: (t: GitTag) => boolean;
		picked?: string | string[];
	} = {},
): Promise<(BranchQuickPickItem | TagQuickPickItem)[]> {
	let branches: GitBranch[] | undefined;
	let tags: GitTag[] | undefined;

	let singleRepo = false;
	if (repos instanceof Repository || repos.length === 1) {
		singleRepo = true;
		const repo = repos instanceof Repository ? repos : repos[0];

		[branches, tags] = await Promise.all<GitBranch[] | undefined, GitTag[] | undefined>([
			include.includes('branches') ? repo.getBranches({ filter: filterBranches, sort: true }) : undefined,
			include.includes('tags') ? repo.getTags({ filter: filterTags, sort: true }) : undefined,
		]);
	} else {
		const [branchesByRepo, tagsByRepo] = await Promise.all<GitBranch[][] | undefined, GitTag[][] | undefined>([
			include.includes('branches')
				? Promise.all(repos.map(r => r.getBranches({ filter: filterBranches, sort: true })))
				: undefined,
			include.includes('tags')
				? Promise.all(repos.map(r => r.getTags({ filter: filterTags, sort: true })))
				: undefined,
		]);

		if (include.includes('branches')) {
			branches = GitBranch.sort(
				Arrays.intersection(...branchesByRepo!, ((b1: GitBranch, b2: GitBranch) => b1.name === b2.name) as any),
			);
		}

		if (include.includes('tags')) {
			tags = GitTag.sort(
				Arrays.intersection(...tagsByRepo!, ((t1: GitTag, t2: GitTag) => t1.name === t2.name) as any),
			);
		}
	}

	if (include.includes('branches') && !include.includes('tags')) {
		return Promise.all(
			branches!.map(b =>
				BranchQuickPickItem.create(
					b,
					picked != null && (typeof picked === 'string' ? b.ref === picked : picked.includes(b.ref)),
					{
						current: singleRepo ? 'checkmark' : false,
						ref: singleRepo,
						status: singleRepo,
						type: 'remote',
					},
				),
			),
		);
	}

	if (include.includes('tags') && !include.includes('branches')) {
		return Promise.all(
			tags!.map(t =>
				TagQuickPickItem.create(
					t,
					picked != null && (typeof picked === 'string' ? t.ref === picked : picked.includes(t.ref)),
					{
						message: false, //singleRepo,
						ref: singleRepo,
					},
				),
			),
		);
	}

	return Promise.all<BranchQuickPickItem | TagQuickPickItem>([
		...branches!
			.filter(b => !b.remote)
			.map(b =>
				BranchQuickPickItem.create(
					b,
					picked != null && (typeof picked === 'string' ? b.ref === picked : picked.includes(b.ref)),
					{
						current: singleRepo ? 'checkmark' : false,
						ref: singleRepo,
						status: singleRepo,
					},
				),
			),
		...tags!.map(t =>
			TagQuickPickItem.create(
				t,
				picked != null && (typeof picked === 'string' ? t.ref === picked : picked.includes(t.ref)),
				{
					message: false, //singleRepo,
					ref: singleRepo,
					type: true,
				},
			),
		),
		...branches!
			.filter(b => b.remote)
			.map(b =>
				BranchQuickPickItem.create(
					b,
					picked != null && (typeof picked === 'string' ? b.ref === picked : picked.includes(b.ref)),
					{
						current: singleRepo ? 'checkmark' : false,
						ref: singleRepo,
						status: singleRepo,
						type: 'remote',
					},
				),
			),
	]);
}

export function getValidateGitReferenceFn(repos: Repository | Repository[]) {
	return async (quickpick: QuickPick<any>, value: string) => {
		let inRefMode = false;
		if (value.startsWith('#')) {
			inRefMode = true;
			value = value.substring(1);
		}

		if (Array.isArray(repos)) {
			if (repos.length !== 1) return false;

			repos = repos[0];
		}

		if (!(await Container.git.validateReference(repos.path, value))) {
			if (inRefMode) {
				quickpick.items = [
					DirectiveQuickPickItem.create(Directive.Back, true, {
						label: 'Enter a reference or commit id',
					}),
				];
				return true;
			}

			return false;
		}

		const commit = await Container.git.getCommit(repos.path, value);
		quickpick.items = [CommitQuickPickItem.create(commit!, true, { alwaysShow: true, compact: true, icon: true })];
		return true;
	};
}

export async function* inputBranchNameStep<
	State extends PartialStepState & ({ repo: Repository } | { repos: Repository[] }),
	Context extends { repos: Repository[]; showTags?: boolean; title: string }
>(
	state: State,
	context: Context,
	options: { placeholder: string; titleContext?: string; value?: string },
): StepResultGenerator<string> {
	const step = QuickCommand.createInputStep({
		title: appendReposToTitle(`${context.title}${options.titleContext ?? ''}`, state, context),
		placeholder: options.placeholder,
		value: options.value,
		prompt: 'Enter branch name',
		validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
			if (value == null) return [false, undefined];

			value = value.trim();
			if (value.length === 0) return [false, 'Please enter a valid branch name'];

			const valid = Boolean(await Container.git.validateBranchOrTagName(value));
			return [valid, valid ? undefined : `'${value}' isn't a valid branch name`];
		},
	});

	const value: StepSelection<typeof step> = yield step;
	if (
		!QuickCommand.canStepContinue(step, state, value) ||
		!(await QuickCommand.canInputStepContinue(step, state, value))
	) {
		return StepResult.Break;
	}

	return value;
}

export async function* inputTagNameStep<
	State extends PartialStepState & ({ repo: Repository } | { repos: Repository[] }),
	Context extends { repos: Repository[]; showTags?: boolean; title: string }
>(
	state: State,
	context: Context,
	options: { placeholder: string; titleContext?: string; value?: string },
): StepResultGenerator<string> {
	const step = QuickCommand.createInputStep({
		title: appendReposToTitle(`${context.title}${options.titleContext ?? ''}`, state, context),
		placeholder: options.placeholder,
		value: options.value,
		prompt: 'Enter tag name',
		validate: async (value: string | undefined): Promise<[boolean, string | undefined]> => {
			if (value == null) return [false, undefined];

			value = value.trim();
			if (value.length === 0) return [false, 'Please enter a valid tag name'];

			const valid = Boolean(await Container.git.validateBranchOrTagName(value));
			return [valid, valid ? undefined : `'${value}' isn't a valid tag name`];
		},
	});

	const value: StepSelection<typeof step> = yield step;
	if (
		!QuickCommand.canStepContinue(step, state, value) ||
		!(await QuickCommand.canInputStepContinue(step, state, value))
	) {
		return StepResult.Break;
	}

	return value;
}

export async function* pickBranchStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; showTags?: boolean; title: string }
>(
	state: State,
	context: Context,
	{
		filterBranches,
		picked,
		placeholder,
		titleContext,
	}: {
		filterBranches?: (b: GitBranch) => boolean;
		picked?: string | string[];
		placeholder: string;
		titleContext?: string;
	},
): StepResultGenerator<GitBranchReference> {
	const branches = await getBranches(state.repo, {
		filterBranches: filterBranches,
		picked: picked,
	});

	const step = QuickCommand.createPickStep<BranchQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: branches.length === 0 ? `No branches found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			branches.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: branches,
		additionalButtons: [QuickCommandButtons.RevealInView],
		onDidClickButton: (quickpick, button) => {
			if (button === QuickCommandButtons.RevealInView) {
				if (quickpick.activeItems.length === 0) {
					void Container.repositoriesView.revealBranches(state.repo.path, {
						select: true,
						expand: true,
					});

					return;
				}

				void Container.repositoriesView.revealBranch(quickpick.activeItems[0].item, {
					select: true,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await Container.repositoriesView.revealBranch(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export async function* pickBranchesStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; showTags?: boolean; title: string }
>(
	state: State,
	context: Context,
	{
		filterBranches,
		picked,
		placeholder,
		titleContext,
	}: {
		filterBranches?: (b: GitBranch) => boolean;
		picked?: string | string[];
		placeholder: string;
		titleContext?: string;
	},
): StepResultGenerator<GitBranchReference[]> {
	const branches = await getBranches(state.repo, {
		filterBranches: filterBranches,
		picked: picked,
	});

	const step = QuickCommand.createPickStep<BranchQuickPickItem>({
		multiselect: branches.length !== 0,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: branches.length === 0 ? `No branches found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			branches.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: branches,
		additionalButtons: [QuickCommandButtons.RevealInView],
		onDidClickButton: (quickpick, button) => {
			if (button === QuickCommandButtons.RevealInView) {
				if (quickpick.activeItems.length === 0) {
					void Container.repositoriesView.revealBranches(state.repo.path, {
						select: true,
						expand: true,
					});

					return;
				}

				void Container.repositoriesView.revealBranch(quickpick.activeItems[0].item, {
					select: true,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await Container.repositoriesView.revealBranch(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResult.Break;
}

export async function* pickBranchOrTagStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; showTags?: boolean; title: string }
>(
	state: State,
	context: Context,
	{
		filterBranches,
		filterTags,
		picked,
		placeholder,
		titleContext,
		value,
		additionalButtons,
	}: {
		filterBranches?: (b: GitBranch) => boolean;
		filterTags?: (t: GitTag) => boolean;
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context) => string);
		titleContext?: string;
		value: string | undefined;
		additionalButtons?: QuickInputButton[];
	},
): StepResultGenerator<GitReference> {
	context.showTags = true;

	const showTagsButton = new QuickCommandButtons.ShowTagsToggle(context.showTags);

	const getBranchesAndOrTagsFn = async () => {
		return getBranchesAndOrTags(state.repo, context.showTags ? ['branches', 'tags'] : ['branches'], {
			filterBranches: filterBranches,
			filterTags: filterTags,
			picked: picked,
		});
	};
	const branchesAndOrTags = await getBranchesAndOrTagsFn();

	const step = QuickCommand.createPickStep<ReferencesQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder:
			branchesAndOrTags.length === 0
				? `No branches${context.showTags ? ' or tags' : ''} found in ${state.repo.formattedName}`
				: `${typeof placeholder === 'string' ? placeholder : placeholder(context)}${GlyphChars.Space.repeat(
						3,
				  )}(or enter a reference using #)`,
		matchOnDescription: true,
		matchOnDetail: true,
		value: value,
		items:
			branchesAndOrTags.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: branchesAndOrTags,
		additionalButtons: [QuickCommandButtons.RevealInView, ...(additionalButtons ?? []), showTagsButton],
		onDidClickButton: async (quickpick, button) => {
			if (button === showTagsButton) {
				quickpick.busy = true;
				quickpick.enabled = false;

				try {
					context.showTags = !context.showTags;
					showTagsButton.on = context.showTags;

					const branchesAndOrTags = await getBranchesAndOrTagsFn();
					quickpick.placeholder =
						branchesAndOrTags.length === 0
							? `${state.repo.formattedName} has no branches${context.showTags ? ' or tags' : ''}`
							: `${
									typeof placeholder === 'string' ? placeholder : placeholder(context)
							  }${GlyphChars.Space.repeat(3)}(or enter a reference using #)`;
					quickpick.items = branchesAndOrTags;
				} finally {
					quickpick.busy = false;
					quickpick.enabled = true;
				}

				return;
			}

			if (button === QuickCommandButtons.RevealInView) {
				if (quickpick.activeItems.length === 0) {
					void Container.repositoriesView.revealBranches(state.repo.path, {
						select: true,
						expand: true,
					});

					return;
				}

				const item = quickpick.activeItems[0].item;
				if (GitReference.isBranch(item)) {
					void Container.repositoriesView.revealBranch(item, { select: true, expand: true });
				} else if (GitReference.isTag(item)) {
					void Container.repositoriesView.revealTag(item, { select: true, expand: true });
				} else if (GitReference.isRevision(item)) {
					void Container.repositoriesView.revealCommit(item, { select: true, expand: true });
				}
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			const item = quickpick.activeItems[0].item;
			if (GitReference.isBranch(item)) {
				void Container.repositoriesView.revealBranch(item, { select: true, focus: false, expand: true });
			} else if (GitReference.isTag(item)) {
				void Container.repositoriesView.revealTag(item, { select: true, focus: false, expand: true });
			} else if (GitReference.isRevision(item)) {
				void Container.repositoriesView.revealCommit(item, { select: true, focus: false, expand: true });
			}
		},
		onValidateValue: getValidateGitReferenceFn(state.repo),
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export async function* pickBranchOrTagStepMultiRepo<
	State extends StepState & { repos: Repository[]; reference?: GitReference },
	Context extends { repos: Repository[]; showTags?: boolean; title: string }
>(
	state: State,
	context: Context,
	{
		filterBranches,
		filterTags,
		picked,
		placeholder,
		titleContext,
		value,
	}: {
		filterBranches?: (b: GitBranch) => boolean;
		filterTags?: (t: GitTag) => boolean;
		picked?: string | string[];
		placeholder: string | ((context: Context) => string);
		titleContext?: string;
		value?: string;
	},
): StepResultGenerator<GitReference> {
	context.showTags = state.repos.length === 1;

	const showTagsButton = new SelectableQuickInputButton('Show Tags', 'tag', context.showTags);

	const getBranchesAndOrTagsFn = () => {
		return getBranchesAndOrTags(state.repos, context.showTags ? ['branches', 'tags'] : ['branches'], {
			// Filter out remote branches if we are going to affect multiple repos
			filterBranches: filterBranches ?? (state.repos.length === 1 ? undefined : b => !b.remote),
			filterTags: filterTags,
			picked: picked ?? state.reference?.ref,
		});
	};
	const branchesAndOrTags = await getBranchesAndOrTagsFn();

	const step = QuickCommand.createPickStep<ReferencesQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder:
			branchesAndOrTags.length === 0
				? `No branches${context.showTags ? ' or tags' : ''} found in ${state.repos[0].formattedName}`
				: `${typeof placeholder === 'string' ? placeholder : placeholder(context)}${GlyphChars.Space.repeat(
						3,
				  )}(or enter a reference using #)`,
		matchOnDescription: true,
		matchOnDetail: true,
		value: value ?? (GitReference.isRevision(state.reference) ? state.reference.ref : undefined),
		items:
			branchesAndOrTags.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: branchesAndOrTags,
		additionalButtons: [QuickCommandButtons.RevealInView, showTagsButton],
		onDidClickButton: async (quickpick, button) => {
			if (button === showTagsButton) {
				quickpick.busy = true;
				quickpick.enabled = false;

				try {
					context.showTags = !context.showTags;
					showTagsButton.on = context.showTags;

					const branchesAndOrTags = await getBranchesAndOrTagsFn();
					quickpick.placeholder =
						branchesAndOrTags.length === 0
							? `${state.repos[0].formattedName} has no branches${context.showTags ? ' or tags' : ''}`
							: `${
									typeof placeholder === 'string' ? placeholder : placeholder(context)
							  }${GlyphChars.Space.repeat(3)}(or enter a reference using #)`;
					quickpick.items = branchesAndOrTags;
				} finally {
					quickpick.busy = false;
					quickpick.enabled = true;
				}
			}

			if (button === QuickCommandButtons.RevealInView) {
				if (quickpick.activeItems.length === 0) {
					if (state.repos.length === 1) {
						void Container.repositoriesView.revealBranches(state.repos[0].path, {
							select: true,
							expand: true,
						});
					}

					return;
				}

				const item = quickpick.activeItems[0].item;
				if (GitReference.isBranch(item)) {
					void Container.repositoriesView.revealBranch(item, { select: true, expand: true });
				} else if (GitReference.isTag(item)) {
					void Container.repositoriesView.revealTag(item, { select: true, expand: true });
				} else if (GitReference.isRevision(item)) {
					void Container.repositoriesView.revealCommit(item, { select: true, expand: true });
				}
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			const item = quickpick.activeItems[0].item;
			if (GitReference.isBranch(item)) {
				void Container.repositoriesView.revealBranch(item, { select: true, focus: false, expand: true });
			} else if (GitReference.isTag(item)) {
				void Container.repositoriesView.revealTag(item, { select: true, focus: false, expand: true });
			} else if (GitReference.isRevision(item)) {
				void Container.repositoriesView.revealCommit(item, { select: true, focus: false, expand: true });
			}
		},
		onValidateValue: getValidateGitReferenceFn(state.repos),
	});

	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export function* pickCommitStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string }
>(
	state: State,
	context: Context,
	{
		log,
		onDidLoadMore,
		picked,
		placeholder,
		showInViewButton: showInView,
		titleContext,
	}: {
		log: GitLog | undefined;
		onDidLoadMore?: (log: GitLog | undefined) => void;
		picked?: string | string[] | undefined;
		placeholder: string | ((context: Context, log: GitLog | undefined) => string);
		showInViewButton?: {
			button: QuickInputButton;
			onDidClick: (items: Readonly<CommitQuickPickItem<GitLogCommit>[]>) => void;
		};
		titleContext?: string;
	},
): StepResultGenerator<GitLogCommit> {
	function getItems(log: GitLog | undefined) {
		return log == null
			? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
			: [
					...Iterables.map(log.commits.values(), commit =>
						CommitQuickPickItem.create(
							commit,
							picked != null &&
								(typeof picked === 'string' ? commit.ref === picked : picked.includes(commit.ref)),
							{ compact: true, icon: true },
						),
					),
					...(log?.hasMore ? [DirectiveQuickPickItem.create(Directive.LoadMore)] : []),
			  ];
	}

	const step = QuickCommand.createPickStep<CommitQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: typeof placeholder === 'string' ? placeholder : placeholder(context, log),
		matchOnDescription: true,
		matchOnDetail: true,
		value: typeof picked === 'string' && log?.count === 0 ? picked : undefined,
		items: getItems(log),
		onDidLoadMore: async quickpick => {
			log = await log?.more?.(configuration.get('advanced', 'maxListItems'));
			onDidLoadMore?.(log);
			if (typeof placeholder !== 'string') {
				quickpick.placeholder = placeholder(context, log);
			}
			return getItems(log);
		},
		additionalButtons: [
			QuickCommandButtons.RevealInView,
			showInView?.button ?? QuickCommandButtons.ShowInView,
			...(log?.hasMore ? [QuickCommandButtons.LoadMore] : []),
		],
		onDidClickButton: (quickpick, button) => {
			if (log == null) return;

			if (button === showInView?.button) {
				showInView.onDidClick(quickpick.activeItems);

				return;
			}

			if (quickpick.activeItems.length === 0 || log == null) return;

			if (button === QuickCommandButtons.RevealInView) {
				void Container.repositoriesView.revealCommit(quickpick.activeItems[0].item, {
					select: true,
					focus: false,
					expand: true,
				});

				return;
			}

			if (button === QuickCommandButtons.ShowInView) {
				void Container.searchView.search(
					state.repo.path,
					{ pattern: SearchPattern.fromCommit(quickpick.activeItems[0].item.ref) },
					{
						label: {
							label: `for ${GitReference.toString(quickpick.activeItems[0].item, { icon: false })}`,
						},
						reveal: {
							select: true,
							focus: false,
							expand: true,
						},
					},
				);
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			if (key === 'ctrl+right') {
				await Container.repositoriesView.revealCommit(quickpick.activeItems[0].item, {
					select: true,
					focus: false,
					expand: true,
				});
			} else {
				const commit = quickpick.activeItems[0].item;
				await Container.searchView.search(
					commit.repoPath,
					{ pattern: SearchPattern.fromCommit(commit) },
					{
						label: { label: `for ${GitReference.toString(commit, { icon: false })}` },
						reveal: {
							select: true,
							focus: false,
							expand: true,
						},
					},
				);
			}
		},
		onValidateValue: getValidateGitReferenceFn(state.repo),
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export function* pickCommitsStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string }
>(
	state: State,
	context: Context,
	{
		log,
		onDidLoadMore,
		picked,
		placeholder,
		titleContext,
	}: {
		log: GitLog | undefined;
		onDidLoadMore?: (log: GitLog | undefined) => void;
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context, log: GitLog | undefined) => string);
		titleContext?: string;
	},
): StepResultGenerator<GitRevisionReference[]> {
	function getItems(log: GitLog | undefined) {
		return log == null
			? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
			: [
					...Iterables.map(log.commits.values(), commit =>
						CommitQuickPickItem.create(
							commit,
							picked != null &&
								(typeof picked === 'string' ? commit.ref === picked : picked.includes(commit.ref)),
							{ compact: true, icon: true },
						),
					),
					// Since this is multi-select, we can have a "Load more" item
					// ...(log?.hasMore ? [DirectiveQuickPickItem.create(Directive.LoadMore)] : []),
			  ];
	}

	const step = QuickCommand.createPickStep<CommitQuickPickItem>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		multiselect: log != null,
		placeholder: typeof placeholder === 'string' ? placeholder : placeholder(context, log),
		matchOnDescription: true,
		matchOnDetail: true,
		items: getItems(log),
		onDidLoadMore: async quickpick => {
			log = await log?.more?.(configuration.get('advanced', 'maxListItems'));
			onDidLoadMore?.(log);
			if (typeof placeholder !== 'string') {
				quickpick.placeholder = placeholder(context, log);
			}
			return getItems(log);
		},
		additionalButtons: [
			QuickCommandButtons.RevealInView,
			QuickCommandButtons.ShowInView,
			...(log?.hasMore ? [QuickCommandButtons.LoadMore] : []),
		],
		onDidClickButton: (quickpick, button) => {
			if (quickpick.activeItems.length === 0 || log == null) return;

			if (button === QuickCommandButtons.RevealInView) {
				void Container.repositoriesView.revealCommit(quickpick.activeItems[0].item, {
					select: true,
					focus: false,
					expand: true,
				});

				return;
			}

			if (button === QuickCommandButtons.ShowInView) {
				void Container.searchView.search(
					state.repo.path,
					{ pattern: SearchPattern.fromCommit(quickpick.activeItems[0].item.ref) },
					{
						label: {
							label: `for ${GitReference.toString(quickpick.activeItems[0].item, { icon: false })}`,
						},
						reveal: {
							select: true,
							focus: false,
							expand: true,
						},
					},
				);
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			if (key === 'ctrl+right') {
				await Container.repositoriesView.revealCommit(quickpick.activeItems[0].item, {
					select: true,
					focus: false,
					expand: true,
				});
			} else {
				const commit = quickpick.activeItems[0].item;
				await Container.searchView.search(
					commit.repoPath,
					{ pattern: SearchPattern.fromCommit(commit) },
					{
						label: { label: `for ${GitReference.toString(commit, { icon: false })}` },
						reveal: {
							select: true,
							focus: false,
							expand: true,
						},
					},
				);
			}
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResult.Break;
}

export async function* pickContributorsStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string }
>(state: State, context: Context, placeholder: string = 'Choose contributors'): StepResultGenerator<GitContributor[]> {
	const message = (await GitService.getBuiltInGitApi())?.repositories.find(
		r => Strings.normalizePath(r.rootUri.fsPath) === state.repo.path,
	)?.inputBox.value;

	const step = QuickCommand.createPickStep<ContributorQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		allowEmpty: true,
		multiselect: true,
		placeholder: placeholder,
		matchOnDescription: true,
		items: (await Container.git.getContributors(state.repo.path)).map(c =>
			ContributorQuickPickItem.create(c, message?.includes(c.toCoauthor())),
		),
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResult.Break;
}

export async function* pickRepositoryStep<
	State extends PartialStepState & { repo?: string | Repository },
	Context extends { repos: Repository[]; title: string }
>(state: State, context: Context, placeholder: string = 'Choose a repository'): StepResultGenerator<Repository> {
	if (typeof state.repo === 'string') {
		state.repo = await Container.git.getRepository(state.repo);
		if (state.repo != null) return state.repo;
	}
	const active = state.repo ?? (await Container.git.getActiveRepository());

	const step = QuickCommand.createPickStep<RepositoryQuickPickItem>({
		title: context.title,
		placeholder: placeholder,
		items:
			context.repos.length === 0
				? [DirectiveQuickPickItem.create(Directive.Cancel)]
				: await Promise.all(
						context.repos.map(r =>
							RepositoryQuickPickItem.create(r, r.id === active?.id, {
								branch: true,
								fetched: true,
								status: true,
							}),
						),
				  ),
		additionalButtons: [QuickCommandButtons.RevealInView],
		onDidClickButton: (quickpick, button) => {
			if (button === QuickCommandButtons.RevealInView) {
				if (quickpick.activeItems.length === 0) return;

				void Container.repositoriesView.revealRepository(quickpick.activeItems[0].item.path, {
					select: true,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			void Container.repositoriesView.revealRepository(quickpick.activeItems[0].item.path, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export async function* pickRepositoriesStep<
	State extends PartialStepState & { repos?: string[] | Repository[] },
	Context extends { repos: Repository[]; title: string }
>(state: State, context: Context, placeholder: string = 'Choose repositories'): StepResultGenerator<Repository[]> {
	let actives: Repository[];
	if (state.repos) {
		if (Arrays.isStringArray(state.repos)) {
			actives = Arrays.filterMap(state.repos, path => context.repos.find(r => r.path === path));
		} else {
			actives = state.repos;
		}
	} else {
		const active = await Container.git.getActiveRepository();
		actives = active ? [active] : [];
	}

	const step = QuickCommand.createPickStep<RepositoryQuickPickItem>({
		multiselect: true,
		title: context.title,
		placeholder: placeholder,
		items:
			context.repos.length === 0
				? [DirectiveQuickPickItem.create(Directive.Cancel)]
				: await Promise.all(
						context.repos.map(repo =>
							RepositoryQuickPickItem.create(
								repo,
								actives.some(r => r.id === repo.id),
								{
									branch: true,
									fetched: true,
									status: true,
								},
							),
						),
				  ),
		additionalButtons: [QuickCommandButtons.RevealInView],
		onDidClickButton: (quickpick, button) => {
			if (button === QuickCommandButtons.RevealInView) {
				if (quickpick.activeItems.length === 0) return;

				void Container.repositoriesView.revealRepository(quickpick.activeItems[0].item.path, {
					select: true,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: quickpick => {
			if (quickpick.activeItems.length === 0) return;

			void Container.repositoriesView.revealRepository(quickpick.activeItems[0].item.path, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResult.Break;
}

export function* pickStashStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string }
>(
	state: State,
	context: Context,
	{
		stash,
		picked,
		placeholder,
		titleContext,
	}: {
		stash: GitStash | undefined;
		picked: string | string[] | undefined;
		placeholder: string | ((context: Context, stash: GitStash | undefined) => string);
		titleContext?: string;
	},
): StepResultGenerator<GitStashCommit> {
	const step = QuickCommand.createPickStep<CommitQuickPickItem<GitStashCommit>>({
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: typeof placeholder === 'string' ? placeholder : placeholder(context, stash),
		matchOnDescription: true,
		matchOnDetail: true,
		items:
			stash == null
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: [
						...Iterables.map(stash.commits.values(), commit =>
							CommitQuickPickItem.create(
								commit,
								picked != null &&
									(typeof picked === 'string' ? commit.ref === picked : picked.includes(commit.ref)),
								{ compact: true, icon: true },
							),
						),
				  ],
		additionalButtons: [QuickCommandButtons.RevealInView, QuickCommandButtons.ShowInView],
		onDidClickButton: (quickpick, button) => {
			if (button === QuickCommandButtons.RevealInView) {
				if (quickpick.activeItems.length === 0) {
					void Container.repositoriesView.revealStashes(state.repo.path, {
						select: true,
						expand: true,
					});
				} else {
					void Container.repositoriesView.revealStash(quickpick.activeItems[0].item, {
						select: true,
						focus: false,
						expand: true,
					});
				}

				return;
			}

			if (button === QuickCommandButtons.ShowInView) {
				if (quickpick.activeItems.length === 0) return;

				void Container.searchView.search(
					state.repo.path,
					{ pattern: SearchPattern.fromCommit(quickpick.activeItems[0].item.stashName) },
					{
						label: {
							label: `for ${GitReference.toString(quickpick.activeItems[0].item, { icon: false })}`,
						},
						reveal: {
							select: true,
							focus: false,
							expand: true,
						},
					},
				);
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await Container.repositoriesView.revealStash(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0].item : StepResult.Break;
}

export async function* pickTagsStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; showTags?: boolean; title: string }
>(
	state: State,
	context: Context,
	{
		filterTags,
		picked,
		placeholder,
		titleContext,
	}: {
		filterTags?: (b: GitTag) => boolean;
		picked?: string | string[];
		placeholder: string;
		titleContext?: string;
	},
): StepResultGenerator<GitTagReference[]> {
	const tags = await getTags(state.repo, {
		filterTags: filterTags,
		picked: picked,
	});

	const step = QuickCommand.createPickStep<TagQuickPickItem>({
		multiselect: tags.length !== 0,
		title: appendReposToTitle(`${context.title}${titleContext ?? ''}`, state, context),
		placeholder: tags.length === 0 ? `No tags found in ${state.repo.formattedName}` : placeholder,
		matchOnDetail: true,
		items:
			tags.length === 0
				? [DirectiveQuickPickItem.create(Directive.Back, true), DirectiveQuickPickItem.create(Directive.Cancel)]
				: tags,
		additionalButtons: [QuickCommandButtons.RevealInView],
		onDidClickButton: (quickpick, button) => {
			if (button === QuickCommandButtons.RevealInView) {
				if (quickpick.activeItems.length === 0) {
					void Container.repositoriesView.revealTags(state.repo.path, {
						select: true,
						expand: true,
					});

					return;
				}

				void Container.repositoriesView.revealTag(quickpick.activeItems[0].item, {
					select: true,
					expand: true,
				});
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async quickpick => {
			if (quickpick.activeItems.length === 0) return;

			await Container.repositoriesView.revealTag(quickpick.activeItems[0].item, {
				select: true,
				focus: false,
				expand: true,
			});
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection.map(i => i.item) : StepResult.Break;
}

export async function* showCommitOrStashStep<
	State extends PartialStepState & { repo: Repository; reference: GitLogCommit | GitStashCommit },
	Context extends { repos: Repository[]; title: string }
>(
	state: State,
	context: Context,
): StepResultGenerator<CommitFilesQuickPickItem | GitCommandQuickPickItem | CommandQuickPickItem> {
	const step: QuickPickStep<
		CommitFilesQuickPickItem | GitCommandQuickPickItem | CommandQuickPickItem
	> = QuickCommand.createPickStep({
		title: appendReposToTitle(
			GitReference.toString(state.reference, {
				capitalize: true,
				icon: false,
			}),
			state,
			context,
		),
		placeholder: GitReference.toString(state.reference, { capitalize: true, icon: false }),
		items: await getShowCommitOrStashStepItems(state),
		additionalButtons: GitReference.isStash(state.reference)
			? [QuickCommandButtons.RevealInView]
			: [QuickCommandButtons.RevealInView, QuickCommandButtons.ShowInView],
		onDidClickButton: (quickpick, button) => {
			if (button === QuickCommandButtons.ShowInView) {
				void Container.searchView.search(
					state.repo.path,
					{ pattern: SearchPattern.fromCommit(state.reference.ref) },
					{
						label: { label: `for ${GitReference.toString(state.reference, { icon: false })}` },
						reveal: {
							select: true,
							focus: false,
							expand: true,
						},
					},
				);

				return;
			}

			if (button === QuickCommandButtons.RevealInView) {
				if (GitReference.isStash(state.reference)) {
					void Container.repositoriesView.revealStash(state.reference, {
						select: true,
						focus: false,
						expand: true,
					});
				} else {
					void Container.repositoriesView.revealCommit(state.reference, {
						select: true,
						focus: false,
						expand: true,
					});
				}
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			void (await quickpick.activeItems[0].onDidPressKey(key));
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0] : StepResult.Break;
}

async function getShowCommitOrStashStepItems<
	State extends PartialStepState & { repo: Repository; reference: GitLogCommit | GitStashCommit }
>(state: State) {
	const items: CommandQuickPickItem[] = [new CommitFilesQuickPickItem(state.reference)];

	const branch = await Container.git.getBranch(state.repo.path);
	let remotes: GitRemote<RemoteProvider>[] | undefined;

	let isStash = false;
	if (GitStashCommit.is(state.reference)) {
		isStash = true;

		items.push(
			new GitCommandQuickPickItem('Apply Stash...', {
				command: 'stash',
				state: {
					subcommand: 'apply',
					repo: state.repo,
					reference: state.reference,
				},
			}),

			new GitCommandQuickPickItem('Delete Stash...', {
				command: 'stash',
				state: {
					subcommand: 'drop',
					repo: state.repo,
					reference: state.reference,
				},
			}),
			new RevealInRepositoriesViewQuickPickItem(state.reference),
		);
	} else {
		remotes = await Container.git.getRemotes(state.repo.path, { sort: true });

		items.push(
			new GitCommandQuickPickItem('Checkout Commit...', {
				command: 'switch',
				state: {
					repos: [state.repo],
					reference: state.reference,
				},
			}),
		);
		items.push(
			new GitCommandQuickPickItem('Revert Commit...', {
				command: 'revert',
				state: {
					repo: state.repo,
					references: [state.reference],
				},
			}),
			new GitCommandQuickPickItem(`Reset ${branch?.name ?? 'HEAD'} to Commit...`, {
				command: 'reset',
				state: {
					repo: state.repo,
					reference: state.reference,
				},
			}),
			new GitCommandQuickPickItem(`Rebase ${branch?.name ?? 'HEAD'} onto Commit...`, {
				command: 'rebase',
				state: {
					repo: state.repo,
					reference: state.reference,
				},
			}),
			new GitCommandQuickPickItem('Create Branch at Commit...', {
				command: 'branch',
				state: {
					subcommand: 'create',
					repo: state.repo,
					reference: state.reference,
				},
			}),
			new GitCommandQuickPickItem('Create Tag at Commit...', {
				command: 'tag',
				state: {
					subcommand: 'create',
					repo: state.repo,
					reference: state.reference,
				},
			}),
			new RevealInRepositoriesViewQuickPickItem(state.reference),
			new OpenInSearchCommitsViewQuickPickItem(state.reference),
		);
	}

	items.push(
		new CommitOpenAllChangesCommandQuickPickItem(state.reference),
		new CommitOpenAllChangesWithDiffToolCommandQuickPickItem(state.reference),
		new CommitOpenAllChangesWithWorkingCommandQuickPickItem(state.reference),

		new CommitOpenDirectoryCompareCommandQuickPickItem(state.reference),
		new CommitOpenDirectoryCompareWithWorkingCommandQuickPickItem(state.reference),

		new CommitOpenFilesCommandQuickPickItem(state.reference),
		new CommitOpenRevisionsCommandQuickPickItem(state.reference),
	);

	if (remotes?.length) {
		items.push(
			new OpenRemoteResourceCommandQuickPickItem(remotes, {
				type: RemoteResourceType.Commit,
				sha: state.reference.sha,
			}),
		);
	}

	// TODO@eamodio add Browse Repository at Revision
	// TODO@eamodio add Compare with HEAD
	// TODO@eamodio add Compare with Working Tree options

	if (!isStash) {
		items.push(new CommitCopyIdQuickPickItem(state.reference));
	}

	items.push(new CommitCopyMessageQuickPickItem(state.reference));

	if (remotes?.length) {
		items.push(
			new CopyRemoteResourceCommandQuickPickItem(remotes, {
				type: RemoteResourceType.Commit,
				sha: state.reference.sha,
			}),
		);
	}

	return items;
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function* showCommitOrStashFilesStep<
	State extends PartialStepState & {
		repo: Repository;
		reference: GitLogCommit | GitStashCommit;
		fileName?: string | undefined;
	},
	Context extends { repos: Repository[]; title: string }
>(
	state: State,
	context: Context,
	options?: { picked?: string },
): StepResultGenerator<CommitFilesQuickPickItem | CommitFileQuickPickItem> {
	const step: QuickPickStep<CommitFilesQuickPickItem | CommitFileQuickPickItem> = QuickCommand.createPickStep({
		title: appendReposToTitle(
			GitReference.toString(state.reference, {
				capitalize: true,
				icon: false,
			}),
			state,
			context,
		),
		placeholder: GitReference.toString(state.reference, { capitalize: true, icon: false }),
		items: [
			new CommitFilesQuickPickItem(state.reference, state.fileName == null),
			...state.reference.files.map(
				fs => new CommitFileQuickPickItem(state.reference, fs, options?.picked === fs.fileName),
			),
		],
		matchOnDescription: true,
		additionalButtons: [QuickCommandButtons.RevealInView, QuickCommandButtons.ShowInView],
		onDidClickButton: (quickpick, button) => {
			if (button === QuickCommandButtons.ShowInView) {
				void Container.searchView.search(
					state.repo.path,
					{ pattern: SearchPattern.fromCommit(state.reference.ref) },
					{
						label: { label: `for ${GitReference.toString(state.reference, { icon: false })}` },
						reveal: {
							select: true,
							focus: false,
							expand: true,
						},
					},
				);

				return;
			}

			if (button === QuickCommandButtons.RevealInView) {
				if (GitReference.isStash(state.reference)) {
					void Container.repositoriesView.revealStash(state.reference, {
						select: true,
						focus: false,
						expand: true,
					});
				} else {
					void Container.repositoriesView.revealCommit(state.reference, {
						select: true,
						focus: false,
						expand: true,
					});
				}
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			void (await quickpick.activeItems[0].onDidPressKey(key));
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0] : StepResult.Break;
}

export async function* showCommitOrStashFileStep<
	State extends PartialStepState & {
		repo: Repository;
		reference: GitLogCommit | GitStashCommit;
		fileName: string;
	},
	Context extends { repos: Repository[]; title: string }
>(state: State, context: Context): StepResultGenerator<CommandQuickPickItem> {
	const step: QuickPickStep<CommandQuickPickItem> = QuickCommand.createPickStep<CommandQuickPickItem>({
		title: appendReposToTitle(
			GitReference.toString(state.reference, {
				capitalize: true,
				icon: false,
			}),
			state,
			context,
			`${Strings.pad(GlyphChars.Dot, 2, 2)}${GitUri.getFormattedPath(state.fileName, {
				relativeTo: state.repo.path,
				truncateTo: 35,
			})}`,
		),
		placeholder: `${GitUri.getFormattedPath(state.fileName, {
			relativeTo: state.repo.path,
		})} in ${GitReference.toString(state.reference, {
			icon: false,
		})}`,
		items: await getShowCommitOrStashFileStepItems(state),
		matchOnDescription: true,
		additionalButtons: [QuickCommandButtons.RevealInView, QuickCommandButtons.ShowInView],
		onDidClickButton: (quickpick, button) => {
			if (button === QuickCommandButtons.ShowInView) {
				void Container.searchView.search(
					state.repo.path,
					{ pattern: SearchPattern.fromCommit(state.reference.ref) },
					{
						label: { label: `for ${GitReference.toString(state.reference, { icon: false })}` },
						reveal: {
							select: true,
							focus: false,
							expand: true,
						},
					},
				);

				return;
			}

			if (button === QuickCommandButtons.RevealInView) {
				if (GitReference.isStash(state.reference)) {
					void Container.repositoriesView.revealStash(state.reference, {
						select: true,
						focus: false,
						expand: true,
					});
				} else {
					void Container.repositoriesView.revealCommit(state.reference, {
						select: true,
						focus: false,
						expand: true,
					});
				}
			}
		},
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			void (await quickpick.activeItems[0].onDidPressKey(key));
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0] : StepResult.Break;
}

async function getShowCommitOrStashFileStepItems<
	State extends PartialStepState & {
		repo: Repository;
		reference: GitLogCommit | GitStashCommit;
		fileName: string;
	}
>(state: State) {
	const file = state.reference.files.find(f => f.fileName === state.fileName);
	if (file == null) return [];

	const items: CommandQuickPickItem[] = [new CommitFilesQuickPickItem(state.reference)];

	let remotes: GitRemote<RemoteProvider>[] | undefined;

	items.push(
		new CommitApplyFileChangesCommandQuickPickItem(state.reference, file),
		new CommitRestoreFileChangesCommandQuickPickItem(state.reference, file),

		new RevealInRepositoriesViewQuickPickItem(state.reference),
	);

	let isStash = false;
	if (GitStashCommit.is(state.reference)) {
		isStash = true;
	} else {
		remotes = await Container.git.getRemotes(state.repo.path, { sort: true });

		// TODO@eamodio Show commit actions here?
		// items.push(
		// 	new GitCommandQuickPickItem('Checkout Commit...', {
		// 		command: 'switch',
		// 		state: {
		// 			repos: [state.repo],
		// 			reference: state.reference,
		// 		},
		// 	}),
		// );
		// items.push(
		// 	new GitCommandQuickPickItem('Revert Commit...', {
		// 		command: 'revert',
		// 		state: {
		// 			repo: state.repo,
		// 			references: [state.reference],
		// 		},
		// 	}),
		// );
		// items.push(
		// 	new GitCommandQuickPickItem(`Reset ${branch?.name ?? 'HEAD'} to Commit...`, {
		// 		command: 'reset',
		// 		state: {
		// 			repo: state.repo,
		// 			reference: state.reference,
		// 		},
		// 	}),
		// );
		// items.push(
		// 	new GitCommandQuickPickItem(`Rebase ${branch?.name ?? 'HEAD'} onto Commit...`, {
		// 		command: 'rebase',
		// 		state: {
		// 			repo: state.repo,
		// 			reference: state.reference,
		// 		},
		// 	}),
		// );
		// items.push(
		// 	new GitCommandQuickPickItem('Create Branch at Commit...', {
		// 		command: 'branch',
		// 		state: {
		// 			subcommand: 'create',
		// 			repo: state.repo,
		// 			reference: state.reference,
		// 		},
		// 	}),
		// );
		// items.push(
		// 	new GitCommandQuickPickItem('Create Tag at Commit...', {
		// 		command: 'tag',
		// 		state: {
		// 			subcommand: 'create',
		// 			repo: state.repo,
		// 			reference: state.reference,
		// 		},
		// 	}),
		// );
		items.push(new OpenInSearchCommitsViewQuickPickItem(state.reference));
	}

	items.push(
		new CommitOpenChangesCommandQuickPickItem(state.reference, state.fileName),
		new CommitOpenChangesWithDiffToolCommandQuickPickItem(state.reference, state.fileName),
		new CommitOpenChangesWithWorkingCommandQuickPickItem(state.reference, state.fileName),
	);

	if (file.status !== 'D') {
		items.push(new CommitOpenFileCommandQuickPickItem(state.reference, file));
	}
	items.push(new CommitOpenRevisionCommandQuickPickItem(state.reference, file));

	if (remotes?.length) {
		items.push(
			new OpenRemoteResourceCommandQuickPickItem(remotes, {
				type: RemoteResourceType.Revision,
				fileName: state.fileName,
				commit: state.reference,
			}),
			new OpenRemoteResourceCommandQuickPickItem(remotes, {
				type: RemoteResourceType.Commit,
				sha: state.reference.ref,
			}),
		);
	}

	if (!isStash) {
		items.push(new CommitCopyIdQuickPickItem(state.reference));
	}
	items.push(new CommitCopyMessageQuickPickItem(state.reference));

	if (remotes?.length) {
		items.push(
			new CopyRemoteResourceCommandQuickPickItem(remotes, {
				type: RemoteResourceType.Commit,
				sha: state.reference.sha,
			}),
			new CopyRemoteResourceCommandQuickPickItem(remotes, {
				type: RemoteResourceType.Revision,
				fileName: state.fileName,
				commit: state.reference,
			}),
		);
	}

	return items;
}

export function* showRepositoryStatusStep<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string; status: GitStatus }
>(state: State, context: Context): StepResultGenerator<CommandQuickPickItem> {
	const upstream = context.status.getUpstreamStatus({ expand: true, separator: ', ' });
	const working = context.status.getFormattedDiffStatus({ expand: true, separator: ', ' });
	const step: QuickPickStep<CommandQuickPickItem> = QuickCommand.createPickStep<CommandQuickPickItem>({
		title: appendReposToTitle(context.title, state, context),
		placeholder: `${upstream ? `${upstream}, ${working}` : working}`, //'Changes to be committed',
		items: getShowRepositoryStatusStepItems(state, context),
		keys: ['right', 'alt+right', 'ctrl+right'],
		onDidPressKey: async (quickpick, key) => {
			if (quickpick.activeItems.length === 0) return;

			void (await quickpick.activeItems[0].onDidPressKey(key));
		},
	});
	const selection: StepSelection<typeof step> = yield step;
	return QuickCommand.canPickStepContinue(step, state, selection) ? selection[0] : StepResult.Break;
}

function getShowRepositoryStatusStepItems<
	State extends PartialStepState & { repo: Repository },
	Context extends { repos: Repository[]; title: string; status: GitStatus }
>(state: State, context: Context) {
	const items: (DirectiveQuickPickItem | CommandQuickPickItem)[] = [];

	const computed = context.status.computeWorkingTreeStatus();

	let workingTreeStatus;
	if (computed.staged === 0 && computed.unstaged === 0) {
		workingTreeStatus = 'No working tree changes';
	} else {
		workingTreeStatus = `$(files) ${
			computed.staged ? `${Strings.pluralize('staged file', computed.staged)} (${computed.stagedStatus})` : ''
		}, ${
			computed.unstaged
				? `${Strings.pluralize('unstaged file', computed.unstaged)} (${computed.unstagedStatus})`
				: ''
		}`;
	}

	if (context.status.upstream) {
		if (context.status.state.ahead === 0 && context.status.state.behind === 0) {
			items.push(
				DirectiveQuickPickItem.create(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is up to date with $(git-branch) ${context.status.upstream}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.ahead !== 0 && context.status.state.behind !== 0) {
			items.push(
				DirectiveQuickPickItem.create(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} has diverged from $(git-branch) ${context.status.upstream}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.ahead !== 0) {
			items.push(
				DirectiveQuickPickItem.create(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is ahead of $(git-branch) ${context.status.upstream}`,
					detail: workingTreeStatus,
				}),
			);
		} else if (context.status.state.behind !== 0) {
			items.push(
				DirectiveQuickPickItem.create(Directive.Noop, true, {
					label: `$(git-branch) ${context.status.branch} is behind $(git-branch) ${context.status.upstream}`,
					detail: workingTreeStatus,
				}),
			);
		}

		if (context.status.state.behind !== 0) {
			items.push(
				new GitCommandQuickPickItem(
					`$(cloud-download) ${Strings.pluralize('commit', context.status.state.behind)} behind`,
					{
						command: 'log',
						state: {
							repo: state.repo,
							reference: GitReference.create(
								GitRevision.createRange(context.status.ref, context.status.upstream),
								state.repo.path,
							),
						},
					},
				),
			);
		}

		if (context.status.state.ahead !== 0) {
			items.push(
				new GitCommandQuickPickItem(
					`$(cloud-upload) ${Strings.pluralize('commit', context.status.state.ahead)} ahead`,
					{
						command: 'log',
						state: {
							repo: state.repo,
							reference: GitReference.create(
								GitRevision.createRange(context.status.upstream, context.status.ref),
								state.repo.path,
							),
						},
					},
				),
			);
		}
	} else {
		items.push(
			DirectiveQuickPickItem.create(Directive.Noop, true, {
				label: `$(git-branch) ${context.status.branch} has no upstream`,
				detail: workingTreeStatus,
			}),
		);
	}

	if (context.status.files.length) {
		items.push(
			new OpenChangedFilesCommandQuickPickItem(
				computed.stagedAddsAndChanges.concat(computed.unstagedAddsAndChanges),
			),
		);
	}

	if (computed.staged > 0) {
		items.push(
			new OpenChangedFilesCommandQuickPickItem(computed.stagedAddsAndChanges, {
				label: '$(files) Open Staged Files',
			}),
		);
	}

	if (computed.unstaged > 0) {
		items.push(
			new OpenChangedFilesCommandQuickPickItem(computed.unstagedAddsAndChanges, {
				label: '$(files) Open Unstaged Files',
			}),
		);
	}

	if (context.status.files.length) {
		items.push(new CommandQuickPickItem('$(x) Close Unchanged Files', Commands.CloseUnchangedFiles));
	}

	return items;
}
