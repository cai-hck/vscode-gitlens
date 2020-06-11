'use strict';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitLog, GitLogCommit, Repository, SearchOperators, searchOperators, SearchPattern } from '../../git/git';
import { GitCommandsCommand } from '../gitCommands';
import {
	appendReposToTitle,
	PartialStepState,
	pickCommitStep,
	pickRepositoryStep,
	QuickCommand,
	QuickCommandButtons,
	StepGenerator,
	StepResult,
	StepResultGenerator,
	StepSelection,
	StepState,
} from '../quickCommand';
import { QuickPickItemOfT } from '../../quickpicks';
import { Strings } from '../../system';

interface Context {
	repos: Repository[];
	commit: GitLogCommit | undefined;
	resultsKey: string | undefined;
	resultsPromise: Promise<GitLog | undefined> | undefined;
	title: string;
}

interface State extends Required<SearchPattern> {
	repo: string | Repository;
	showResultsInView: boolean;
}

export interface SearchGitCommandArgs {
	readonly command: 'search';
	prefillOnly?: boolean;
	state?: Partial<State>;
}

const searchOperatorToTitleMap = new Map<SearchOperators, string>([
	['', 'Search by Message'],
	['=:', 'Search by Message'],
	['message:', 'Search by Message'],
	['@:', 'Search by Author'],
	['author:', 'Search by Author'],
	['#:', 'Search by Commit ID'],
	['commit:', 'Search by Commit ID'],
	['?:', 'Search by File'],
	['file:', 'Search by File'],
	['~:', 'Search by Changes'],
	['change:', 'Search by Changes'],
]);

type SearchStepState<T extends State = State> = ExcludeSome<StepState<T>, 'repo', string>;

export class SearchGitCommand extends QuickCommand<State> {
	constructor(args?: SearchGitCommandArgs) {
		super('search', 'search', 'Commit Search', {
			description: 'aka grep, searches for commits',
		});

		let counter = 0;
		if (args?.state?.repo != null) {
			counter++;
		}

		if (args?.state?.pattern != null && !args.prefillOnly) {
			counter++;
		}

		this.initialState = {
			counter: counter,
			confirm: false,
			...args?.state,
		};
	}

	get canConfirm(): boolean {
		return false;
	}

	isMatch(name: string) {
		return super.isMatch(name) || name === 'grep';
	}

	protected async *steps(state: PartialStepState<State>): StepGenerator {
		const context: Context = {
			repos: [...(await Container.git.getOrderedRepositories())],
			commit: undefined,
			resultsKey: undefined,
			resultsPromise: undefined,
			title: this.title,
		};

		const cfg = Container.config.gitCommands.search;
		if (state.matchAll == null) {
			state.matchAll = cfg.matchAll;
		}
		if (state.matchCase == null) {
			state.matchCase = cfg.matchCase;
		}
		if (state.matchRegex == null) {
			state.matchRegex = cfg.matchRegex;
		}
		if (state.showResultsInView == null) {
			state.showResultsInView = cfg.showResultsInView;
		}

		while (this.canStepsContinue(state)) {
			context.title = this.title;

			if (
				state.counter < 1 ||
				state.repo == null ||
				typeof state.repo === 'string' ||
				!context.repos.includes(state.repo)
			) {
				if (context.repos.length === 1) {
					if (state.repo == null) {
						state.counter++;
					}
					state.repo = context.repos[0];
				} else {
					const result = yield* pickRepositoryStep(state, context);
					// Always break on the first step (so we will go back)
					if (result === StepResult.Break) break;

					state.repo = result;
				}
			}

			if (state.counter < 3 || state.pattern == null) {
				const result = yield* this.pickSearchOperatorStep(state as SearchStepState, context);
				if (result === StepResult.Break) {
					// If we skipped the previous step, make sure we back up past it
					if (context.repos.length === 1) {
						state.counter--;
					}

					state.pattern = undefined;

					continue;
				}

				state.pattern = result;
			}

			const search: SearchPattern = {
				pattern: state.pattern,
				matchAll: state.matchAll,
				matchCase: state.matchCase,
				matchRegex: state.matchRegex,
			};
			const searchKey = SearchPattern.toKey(search);

			if (context.resultsPromise == null || context.resultsKey !== searchKey) {
				context.resultsPromise = Container.git.getLogForSearch(state.repo.path, search);
				context.resultsKey = searchKey;
			}

			if (state.showResultsInView) {
				void Container.searchView.search(
					state.repo.path,
					search,
					{
						label: { label: `for ${state.pattern}` },
					},
					context.resultsPromise,
				);

				break;
			}

			if (state.counter < 4 || context.commit == null) {
				const repoPath = state.repo.path;
				const result = yield* pickCommitStep(state as SearchStepState, context, {
					log: await context.resultsPromise,
					onDidLoadMore: log => (context.resultsPromise = Promise.resolve(log)),
					placeholder: (context, log) =>
						log == null
							? `No results for ${state.pattern}`
							: `${Strings.pluralize('result', log.count, {
									number: log.hasMore ? `${log.count}+` : undefined,
							  })} for ${state.pattern}`,
					picked: context.commit?.ref,
					showInViewButton: {
						button: QuickCommandButtons.ShowResultsInView,
						onDidClick: () =>
							void Container.searchView.search(
								repoPath,
								search,
								{
									label: { label: `for ${state.pattern}` },
									reveal: {
										select: true,
										focus: false,
										expand: true,
									},
								},
								context.resultsPromise,
							),
					},
				});
				if (result === StepResult.Break) continue;

				context.commit = result;
			}

			const result = yield* GitCommandsCommand.getSteps(
				{
					command: 'show',
					state: {
						repo: state.repo,
						reference: context.commit,
					},
				},
				this.pickedVia,
			);
			state.counter--;
			if (result === StepResult.Break) {
				QuickCommand.endSteps(state);
			}
		}

		return state.counter < 0 ? StepResult.Break : undefined;
	}

	private *pickSearchOperatorStep(state: SearchStepState, context: Context): StepResultGenerator<string> {
		const items: QuickPickItemOfT<SearchOperators>[] = [
			{
				label: searchOperatorToTitleMap.get('')!,
				description: `pattern or message: pattern or =: pattern ${GlyphChars.Dash} use quotes to search for phrases`,
				item: 'message:',
			},
			{
				label: searchOperatorToTitleMap.get('author:')!,
				description: 'author: pattern or @: pattern',
				item: 'author:',
			},
			{
				label: searchOperatorToTitleMap.get('commit:')!,
				description: 'commit: sha or #: sha',
				item: 'commit:',
			},
			{
				label: searchOperatorToTitleMap.get('file:')!,
				description: 'file: glob or ?: glob',
				item: 'file:',
			},
			{
				label: searchOperatorToTitleMap.get('change:')!,
				description: 'change: pattern or ~: pattern',
				item: 'change:',
			},
		];

		const matchCaseButton = new QuickCommandButtons.MatchCaseToggle(state.matchCase);
		const matchAllButton = new QuickCommandButtons.MatchAllToggle(state.matchAll);
		const matchRegexButton = new QuickCommandButtons.MatchRegexToggle(state.matchRegex);
		const showResultsInViewButton = new QuickCommandButtons.ShowResultsInViewToggle(state.showResultsInView, () => {
			state.showResultsInView = !state.showResultsInView;
			showResultsInViewButton.on = state.showResultsInView;
		});

		const step = QuickCommand.createPickStep<QuickPickItemOfT<SearchOperators>>({
			title: appendReposToTitle(context.title, state, context),
			placeholder: 'e.g. "Updates dependencies" author:eamodio',
			matchOnDescription: true,
			matchOnDetail: true,
			additionalButtons: [matchCaseButton, matchAllButton, matchRegexButton, showResultsInViewButton],
			items: items,
			value: state.pattern,
			onDidAccept: (quickpick): boolean => {
				const pick = quickpick.selectedItems[0];
				if (!searchOperators.has(pick.item)) return true;

				const value = quickpick.value.trim();
				if (value.length === 0 || searchOperators.has(value)) {
					quickpick.value = pick.item;
				} else {
					quickpick.value = `${value} ${pick.item}`;
				}

				void step.onDidChangeValue!(quickpick);

				return false;
			},
			onDidClickButton: (quickpick, button) => {
				if (button === matchCaseButton) {
					state.matchCase = !state.matchCase;
					matchCaseButton.on = state.matchCase;
				} else if (button === matchAllButton) {
					state.matchAll = !state.matchAll;
					matchAllButton.on = state.matchAll;
				} else if (button === matchRegexButton) {
					state.matchRegex = !state.matchRegex;
					matchRegexButton.on = state.matchRegex;
				}
			},
			onDidChangeValue: (quickpick): boolean => {
				const value = quickpick.value.trim();
				// Simulate an extra step if we have a value
				state.counter = value ? 3 : 2;

				const operations = SearchPattern.parseSearchOperations(value);

				quickpick.title = appendReposToTitle(
					operations.size === 0 || operations.size > 1
						? context.title
						: `Commit ${searchOperatorToTitleMap.get(operations.keys().next().value)!}`,
					state,
					context,
				);

				if (quickpick.value.length === 0) {
					quickpick.items = items;
				} else {
					quickpick.items = [
						{
							label: 'Search for',
							description: quickpick.value,
							item: quickpick.value as SearchOperators,
						},
					];
				}

				return true;
			},
		});
		const selection: StepSelection<typeof step> = yield step;
		if (!QuickCommand.canPickStepContinue(step, state, selection)) return StepResult.Break;

		// Since we simulated a step above, we need to remove it here
		state.counter--;
		return selection[0].item.trim();
	}
}
