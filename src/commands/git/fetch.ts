'use strict';
import { Container } from '../../container';
import { Repository } from '../../git/gitService';
import { QuickCommandBase, QuickPickStep, StepAsyncGenerator, StepSelection, StepState } from '../quickCommand';
import { FlagsQuickPickItem, RepositoryQuickPickItem } from '../../quickpicks';
import { Dates, Strings } from '../../system';
import { GlyphChars } from '../../constants';
import { Logger } from '../../logger';

type Flags = '--all' | '--prune';

interface State {
	repos: Repository[];
	flags: Flags[];
}

export interface FetchGitCommandArgs {
	readonly command: 'fetch';
	state?: Partial<State>;

	confirm?: boolean;
}

export class FetchGitCommand extends QuickCommandBase<State> {
	constructor(args?: FetchGitCommandArgs) {
		super('fetch', 'fetch', 'Fetch', { description: 'fetches changes from one or more remotes' });

		if (args == null || args.state === undefined) return;

		let counter = 0;
		if (args.state.repos !== undefined && args.state.repos.length !== 0) {
			counter++;
		}

		this._initialState = {
			counter: counter,
			confirm: args.confirm,
			...args.state,
		};
	}

	execute(state: State) {
		return Container.git.fetchAll(state.repos, {
			all: state.flags.includes('--all'),
			prune: state.flags.includes('--prune'),
		});
	}

	protected async *steps(): StepAsyncGenerator {
		const state: StepState<State> = this._initialState === undefined ? { counter: 0 } : this._initialState;
		let repos;

		if (state.flags == null) {
			state.flags = [];
		}

		while (true) {
			try {
				if (repos === undefined) {
					repos = [...(await Container.git.getOrderedRepositories())];
				}

				if (state.repos === undefined || state.counter < 1) {
					if (repos.length === 1) {
						state.counter++;
						state.repos = [repos[0]];
					} else {
						let actives: Repository[];
						if (state.repos) {
							actives = state.repos;
						} else {
							const active = await Container.git.getActiveRepository();
							actives = active ? [active] : [];
						}

						const step = this.createPickStep<RepositoryQuickPickItem>({
							multiselect: true,
							title: this.title,
							placeholder: 'Choose repositories',
							items: await Promise.all(
								repos.map(repo =>
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
						});
						const selection: StepSelection<typeof step> = yield step;

						if (!this.canPickStepMoveNext(step, state, selection)) {
							break;
						}

						state.repos = selection.map(i => i.item);
					}
				}

				if (this.confirm(state.confirm)) {
					let fetchedOn = '';
					if (state.repos.length === 1) {
						const lastFetched = await state.repos[0].getLastFetched();
						if (lastFetched !== 0) {
							fetchedOn = `${Strings.pad(GlyphChars.Dot, 2, 2)}Last fetched ${Dates.getFormatter(
								new Date(lastFetched),
							).fromNow()}`;
						}
					}

					const step: QuickPickStep<FlagsQuickPickItem<Flags>> = this.createConfirmStep(
						`Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${
							state.repos.length === 1
								? `${state.repos[0].formattedName}${fetchedOn}`
								: `${state.repos.length} repositories`
						}`,
						[
							FlagsQuickPickItem.create<Flags>(state.flags, [], {
								label: this.title,
								description: '',
								detail: `Will fetch ${
									state.repos.length === 1
										? state.repos[0].formattedName
										: `${state.repos.length} repositories`
								}`,
							}),
							FlagsQuickPickItem.create<Flags>(state.flags, ['--prune'], {
								label: `${this.title} & Prune`,
								description: '--prune',
								detail: `Will fetch and prune ${
									state.repos.length === 1
										? state.repos[0].formattedName
										: `${state.repos.length} repositories`
								}`,
							}),
							FlagsQuickPickItem.create<Flags>(state.flags, ['--all'], {
								label: `${this.title} All`,
								description: '--all',
								detail: `Will fetch all remotes of ${
									state.repos.length === 1
										? state.repos[0].formattedName
										: `${state.repos.length} repositories`
								}`,
							}),
							FlagsQuickPickItem.create<Flags>(state.flags, ['--all', '--prune'], {
								label: `${this.title} All & Prune`,
								description: '--all --prune',
								detail: `Will fetch and prune all remotes of ${
									state.repos.length === 1
										? state.repos[0].formattedName
										: `${state.repos.length} repositories`
								}`,
							}),
						],
					);
					const selection: StepSelection<typeof step> = yield step;

					if (!this.canPickStepMoveNext(step, state, selection)) {
						if (repos.length === 1) {
							break;
						}

						continue;
					}

					state.flags = selection[0].item;
				}

				this.execute(state as State);
				break;
			} catch (ex) {
				Logger.error(ex, this.title);

				throw ex;
			}
		}

		return undefined;
	}
}
