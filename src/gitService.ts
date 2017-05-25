'use strict';
import { Iterables, Objects } from './system';
import { Disposable, Event, EventEmitter, ExtensionContext, FileSystemWatcher, languages, Location, Position, Range, TextDocument, TextEditor, Uri, workspace } from 'vscode';
import { CommandContext, setCommandContext } from './commands';
import { CodeLensVisibility, IConfig } from './configuration';
import { DocumentSchemes, ExtensionKey } from './constants';
import { Git, GitBlameParser, GitBranch, GitCommit, GitDiffParser, GitLogCommit, GitLogParser, GitRemote, GitStashParser, GitStatusFile, GitStatusParser, IGit, IGitAuthor, IGitBlame, IGitBlameLine, IGitBlameLines, IGitDiff, IGitLog, IGitStash, IGitStatus, setDefaultEncoding } from './git/git';
import { GitUri, IGitCommitInfo, IGitUriData } from './git/gitUri';
import { GitCodeLensProvider } from './gitCodeLensProvider';
import { Logger } from './logger';
import * as fs from 'fs';
import * as ignore from 'ignore';
import * as moment from 'moment';
import * as path from 'path';

export { GitUri, IGitCommitInfo };
export * from './git/models/models';
export { getNameFromRemoteResource, RemoteResource, RemoteProvider } from './git/remotes/provider';
export * from './git/gitContextTracker';

class UriCacheEntry {

    constructor(public uri: GitUri) { }
}

class GitCacheEntry {

    private cache: Map<string, ICachedBlame | ICachedDiff | ICachedLog> = new Map();

    constructor(public key: string) { }

    get hasErrors(): boolean {
        return Iterables.every(this.cache.values(), _ => _.errorMessage !== undefined);
    }

    get<T extends ICachedBlame | ICachedDiff | ICachedLog>(key: string): T | undefined {
        return this.cache.get(key) as T;
    }

    set<T extends ICachedBlame | ICachedDiff | ICachedLog>(key: string, value: T) {
        this.cache.set(key, value);
    }
}

interface ICachedItem<T> {
    item: Promise<T>;
    errorMessage?: string;
}

interface ICachedBlame extends ICachedItem<IGitBlame> { }
interface ICachedDiff extends ICachedItem<IGitDiff> { }
interface ICachedLog extends ICachedItem<IGitLog> { }

enum RemoveCacheReason {
    DocumentClosed,
    DocumentSaved
}

export type GitRepoSearchBy = 'author' | 'files' | 'message' | 'sha';
export const GitRepoSearchBy = {
    Author: 'author' as GitRepoSearchBy,
    Files: 'files' as GitRepoSearchBy,
    Message: 'message' as GitRepoSearchBy,
    Sha: 'sha' as GitRepoSearchBy
};

export class GitService extends Disposable {

    private _onDidChangeGitCache = new EventEmitter<void>();
    get onDidChangeGitCache(): Event<void> {
        return this._onDidChangeGitCache.event;
    }

    private _onDidBlameFail = new EventEmitter<string>();
    get onDidBlameFail(): Event<string> {
        return this._onDidBlameFail.event;
    }

    private _gitCache: Map<string, GitCacheEntry>;
    private _remotesCache: Map<string, GitRemote[]>;
    private _cacheDisposable: Disposable | undefined;
    private _uriCache: Map<string, UriCacheEntry>;

    config: IConfig;
    private _codeLensProvider: GitCodeLensProvider | undefined;
    private _codeLensProviderDisposable: Disposable | undefined;
    private _disposable: Disposable | undefined;
    private _fsWatcher: FileSystemWatcher | undefined;
    private _gitignore: Promise<ignore.Ignore>;

    static EmptyPromise: Promise<IGitBlame | IGitDiff | IGitLog | undefined> = Promise.resolve(undefined);

    constructor(private context: ExtensionContext, public repoPath: string) {
        super(() => this.dispose());

        this._gitCache = new Map();
        this._remotesCache = new Map();
        this._uriCache = new Map();

        this._onConfigurationChanged();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable && this._disposable.dispose();

        this._codeLensProviderDisposable && this._codeLensProviderDisposable.dispose();
        this._codeLensProviderDisposable = undefined;
        this._codeLensProvider = undefined;

        this._cacheDisposable && this._cacheDisposable.dispose();
        this._cacheDisposable = undefined;

        this._fsWatcher && this._fsWatcher.dispose();
        this._fsWatcher = undefined;

        this._gitCache.clear();
        this._remotesCache.clear();
        this._uriCache.clear();
    }

    public get UseCaching() {
        return this.config.advanced.caching.enabled;
    }

    private _onConfigurationChanged() {
        const encoding = workspace.getConfiguration('files').get<string>('encoding', 'utf8');
        setDefaultEncoding(encoding);

        const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;

        const codeLensChanged = !Objects.areEquivalent(cfg.codeLens, this.config && this.config.codeLens);
        const advancedChanged = !Objects.areEquivalent(cfg.advanced, this.config && this.config.advanced);

        if (codeLensChanged) {
            Logger.log('CodeLens config changed; resetting CodeLens provider');
            if (cfg.codeLens.visibility === CodeLensVisibility.Auto && (cfg.codeLens.recentChange.enabled || cfg.codeLens.authors.enabled)) {
                if (this._codeLensProvider) {
                    this._codeLensProvider.reset();
                }
                else {
                    this._codeLensProvider = new GitCodeLensProvider(this.context, this);
                    this._codeLensProviderDisposable = languages.registerCodeLensProvider(GitCodeLensProvider.selector, this._codeLensProvider);
                }
            }
            else {
                this._codeLensProviderDisposable && this._codeLensProviderDisposable.dispose();
                this._codeLensProviderDisposable = undefined;
                this._codeLensProvider = undefined;
            }

            setCommandContext(CommandContext.CanToggleCodeLens, cfg.codeLens.visibility !== CodeLensVisibility.Off && (cfg.codeLens.recentChange.enabled || cfg.codeLens.authors.enabled));
        }

        if (advancedChanged) {
            if (cfg.advanced.caching.enabled) {
                this._cacheDisposable && this._cacheDisposable.dispose();

                this._fsWatcher = this._fsWatcher || workspace.createFileSystemWatcher('**/.git/index', true, false, true);

                const disposables: Disposable[] = [];

                disposables.push(workspace.onDidCloseTextDocument(d => this._removeCachedEntry(d, RemoveCacheReason.DocumentClosed)));
                disposables.push(workspace.onDidSaveTextDocument(d => this._removeCachedEntry(d, RemoveCacheReason.DocumentSaved)));
                disposables.push(this._fsWatcher.onDidChange(this._onGitChanged, this));

                this._cacheDisposable = Disposable.from(...disposables);
            }
            else {
                this._cacheDisposable && this._cacheDisposable.dispose();
                this._cacheDisposable = undefined;

                this._fsWatcher && this._fsWatcher.dispose();
                this._fsWatcher = undefined;

                this._gitCache.clear();
                this._remotesCache.clear();
            }

            this._gitignore = new Promise<ignore.Ignore | undefined>((resolve, reject) => {
                if (!cfg.advanced.gitignore.enabled) {
                    resolve(undefined);
                    return;
                }

                const gitignorePath = path.join(this.repoPath, '.gitignore');
                fs.exists(gitignorePath, e => {
                    if (e) {
                        fs.readFile(gitignorePath, 'utf8', (err, data) => {
                            if (!err) {
                                resolve(ignore().add(data));
                                return;
                            }
                            resolve(undefined);
                        });
                        return;
                    }
                    resolve(undefined);
                });
            });
        }

        this.config = cfg;
    }

    private _onGitChanged() {
        this._gitCache.clear();

        this._onDidChangeGitCache.fire();
        this._codeLensProvider && this._codeLensProvider.reset();
    }

    private _removeCachedEntry(document: TextDocument, reason: RemoveCacheReason) {
        if (!this.UseCaching) return;
        if (document.uri.scheme !== DocumentSchemes.File) return;

        const cacheKey = this.getCacheEntryKey(document.fileName);

        if (reason === RemoveCacheReason.DocumentSaved) {
            // Don't remove broken blame on save (since otherwise we'll have to run the broken blame again)
            const entry = this._gitCache.get(cacheKey);
            if (entry && entry.hasErrors) return;
        }

        if (this._gitCache.delete(cacheKey)) {
            Logger.log(`Clear cache entry for '${cacheKey}', reason=${RemoveCacheReason[reason]}`);

            if (reason === RemoveCacheReason.DocumentSaved) {
                this._onDidChangeGitCache.fire();

                // Refresh the codelenses with the updated blame
                this._codeLensProvider && this._codeLensProvider.reset();
            }
        }
    }

    private async _fileExists(repoPath: string, fileName: string): Promise<boolean> {
        return await new Promise<boolean>((resolve, reject) => fs.exists(path.resolve(repoPath, fileName), resolve));
    }

    async findNextCommit(repoPath: string, fileName: string, sha?: string): Promise<GitLogCommit | undefined> {
        let log = await this.getLogForFile(repoPath, fileName, sha, 1, undefined, true);
        let commit = log && Iterables.first(log.commits.values());
        if (commit) return commit;

        const nextFileName = await this.findNextFileName(repoPath, fileName, sha);
        if (nextFileName) {
            log = await this.getLogForFile(repoPath, nextFileName, sha, 1, undefined, true);
            commit = log && Iterables.first(log.commits.values());
        }

        return commit;
    }

    async findNextFileName(repoPath: string | undefined, fileName: string, sha?: string): Promise<string | undefined> {
        [fileName, repoPath] = Git.splitPath(fileName, repoPath);

        return (await this._fileExists(repoPath, fileName))
            ? fileName
            : await this._findNextFileName(repoPath, fileName, sha);
    }

    async _findNextFileName(repoPath: string, fileName: string, sha?: string): Promise<string | undefined> {
        if (sha === undefined) {
            // Get the most recent commit for this file name
            const c = await this.getLogCommit(repoPath, fileName);
            if (!c) return undefined;

            sha = c.sha;
        }

        // Get the full commit (so we can see if there are any matching renames in the file statuses)
        const log = await this.getLogForRepo(repoPath, sha, 1);
        if (!log) return undefined;

        const c = Iterables.first(log.commits.values());
        const status = c.fileStatuses.find(_ => _.originalFileName === fileName);
        if (!status) return undefined;

        return status.fileName;
    }

    async findWorkingFileName(commit: GitCommit): Promise<string | undefined>;
    async findWorkingFileName(repoPath: string | undefined, fileName: string): Promise<string | undefined>;
    async findWorkingFileName(commitOrRepoPath: GitCommit | string | undefined, fileName?: string): Promise<string | undefined> {
        let repoPath: string | undefined;
        if (commitOrRepoPath === undefined || typeof commitOrRepoPath === 'string') {
            repoPath = commitOrRepoPath;
            if (fileName === undefined) throw new Error('Invalid fileName');

            [fileName] = Git.splitPath(fileName, repoPath);
        }
        else {
            const c = commitOrRepoPath;
            repoPath = c.repoPath;
            if (c.workingFileName && await this._fileExists(repoPath, c.workingFileName)) return c.workingFileName;
            fileName = c.fileName;
        }

        while (true) {
            if (await this._fileExists(repoPath!, fileName)) return fileName;

            fileName = await this._findNextFileName(repoPath!, fileName);
            if (fileName === undefined) return undefined;
        }
    }

    public async getBlameability(uri: GitUri): Promise<boolean> {
        if (!this.UseCaching) return await this.isTracked(uri);

        const cacheKey = this.getCacheEntryKey(uri.fsPath);
        const entry = this._gitCache.get(cacheKey);
        if (entry === undefined) return await this.isTracked(uri);

        return !entry.hasErrors;
    }

    async getBlameForFile(uri: GitUri): Promise<IGitBlame | undefined> {
        let key = 'blame';
        if (uri.sha !== undefined) {
            key += `:${uri.sha}`;
        }

        const fileName = uri.fsPath;

        let entry: GitCacheEntry | undefined;
        if (this.UseCaching) {
            const cacheKey = this.getCacheEntryKey(fileName);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined) {
                const cachedBlame = entry.get<ICachedBlame>(key);
                if (cachedBlame !== undefined) {
                    Logger.log(`Cached(${key}): getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);
                    return cachedBlame.item;
                }

                if (key !== 'blame') {
                    // Since we are looking for partial blame, see if we have the blame of the whole file
                    const cachedBlame = entry.get<ICachedBlame>('blame');
                    if (cachedBlame !== undefined) {
                        Logger.log(`? Cache(${key}): getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);
                        const blame = await cachedBlame.item;
                        if (blame !== undefined && blame.commits.has(uri.sha!)) {
                            Logger.log(`Cached(${key}): getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);
                            return cachedBlame.item;
                        }
                    }
                }
            }

            Logger.log(`Not Cached(${key}): getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getBlameForFile('${uri.repoPath}', '${uri.fsPath}', ${uri.sha})`);
        }

        const promise = this._getBlameForFile(uri, fileName, entry, key);

        if (entry) {
            Logger.log(`Add blame cache for '${entry.key}:${key}'`);

            entry.set<ICachedBlame>(key, {
                item: promise
            } as ICachedBlame);
        }

        return promise;
    }

    private async _getBlameForFile(uri: GitUri, fileName: string, entry: GitCacheEntry | undefined, key: string): Promise<IGitBlame | undefined> {
        const [file, root] = Git.splitPath(fileName, uri.repoPath, false);

        const ignore = await this._gitignore;
        if (ignore && !ignore.filter([file]).length) {
            Logger.log(`Skipping blame; '${fileName}' is gitignored`);
            if (entry && entry.key) {
                this._onDidBlameFail.fire(entry.key);
            }
            return await GitService.EmptyPromise as IGitBlame;
        }

        try {
            const data = await Git.blame(root, file, uri.sha);
            return GitBlameParser.parse(data, root, file);
        }
        catch (ex) {
            // Trap and cache expected blame errors
            if (entry) {
                const msg = ex && ex.toString();
                Logger.log(`Replace blame cache with empty promise for '${entry.key}:${key}'`);

                entry.set<ICachedBlame>(key, {
                    item: GitService.EmptyPromise,
                    errorMessage: msg
                } as ICachedBlame);

                this._onDidBlameFail.fire(entry.key);
                return await GitService.EmptyPromise as IGitBlame;
            }

            return undefined;
        }
    }

    async getBlameForLine(uri: GitUri, line: number): Promise<IGitBlameLine | undefined> {
        Logger.log(`getBlameForLine('${uri.repoPath}', '${uri.fsPath}', ${line}, ${uri.sha})`);

        if (this.UseCaching) {
            const blame = await this.getBlameForFile(uri);
            if (blame === undefined) return undefined;

            const blameLine = blame.lines[line];
            if (blameLine === undefined) return undefined;

            const commit = blame.commits.get(blameLine.sha);
            if (commit === undefined) return undefined;

            return {
                author: Object.assign({}, blame.authors.get(commit.author), { lineCount: commit.lines.length }),
                commit: commit,
                line: blameLine
            } as IGitBlameLine;
        }

        const fileName = uri.fsPath;

        try {
            const data = await Git.blame(uri.repoPath, fileName, uri.sha, line + 1, line + 1);
            const blame = GitBlameParser.parse(data, uri.repoPath, fileName);
            if (!blame) return undefined;

            const commit = Iterables.first(blame.commits.values());
            if (uri.repoPath) {
                commit.repoPath = uri.repoPath;
            }
            return {
                author: Iterables.first(blame.authors.values()),
                commit: commit,
                line: blame.lines[line]
            } as IGitBlameLine;
        }
        catch (ex) {
            return undefined;
        }
    }

    async getBlameForRange(uri: GitUri, range: Range): Promise<IGitBlameLines | undefined> {
        Logger.log(`getBlameForRange('${uri.repoPath}', '${uri.fsPath}', [${range.start.line}, ${range.end.line}], ${uri.sha})`);

        const blame = await this.getBlameForFile(uri);
        if (!blame) return undefined;

        return this.getBlameForRangeSync(blame, uri, range);
    }

    getBlameForRangeSync(blame: IGitBlame, uri: GitUri, range: Range): IGitBlameLines | undefined {
        Logger.log(`getBlameForRangeSync('${uri.repoPath}', '${uri.fsPath}', [${range.start.line}, ${range.end.line}], ${uri.sha})`);

        if (!blame.lines.length) return Object.assign({ allLines: blame.lines }, blame);

        if (range.start.line === 0 && range.end.line === blame.lines.length - 1) {
            return Object.assign({ allLines: blame.lines }, blame);
        }

        const lines = blame.lines.slice(range.start.line, range.end.line + 1);
        const shas: Set<string> = new Set();
        lines.forEach(l => shas.add(l.sha));

        const authors: Map<string, IGitAuthor> = new Map();
        const commits: Map<string, GitCommit> = new Map();
        blame.commits.forEach(c => {
            if (!shas.has(c.sha)) return;

            const commit: GitCommit = new GitCommit('blame', c.repoPath, c.sha, c.fileName, c.author, c.date, c.message,
                c.lines.filter(l => l.line >= range.start.line && l.line <= range.end.line), c.originalFileName, c.previousSha, c.previousFileName);
            commits.set(c.sha, commit);

            let author = authors.get(commit.author);
            if (author === undefined) {
                author = {
                    name: commit.author,
                    lineCount: 0
                };
                authors.set(author.name, author);
            }

            author.lineCount += commit.lines.length;
        });

        const sortedAuthors: Map<string, IGitAuthor> = new Map();
        Array.from(authors.values())
            .sort((a, b) => b.lineCount - a.lineCount)
            .forEach(a => sortedAuthors.set(a.name, a));

        return {
            authors: sortedAuthors,
            commits: commits,
            lines: lines,
            allLines: blame.lines
        } as IGitBlameLines;
    }

    async getBlameLocations(uri: GitUri, range: Range, selectedSha?: string, line?: number): Promise<Location[] | undefined> {
        Logger.log(`getBlameLocations('${uri.repoPath}', '${uri.fsPath}', [${range.start.line}, ${range.end.line}], ${uri.sha})`);

        const blame = await this.getBlameForRange(uri, range);
        if (!blame) return undefined;

        const commitCount = blame.commits.size;

        const locations: Location[] = [];
        Iterables.forEach(blame.commits.values(), (c, i) => {
            if (c.isUncommitted) return;

            const decoration = `\u2937 ${c.author}, ${moment(c.date).format('MMMM Do, YYYY h:MMa')}`;
            const uri = GitService.toReferenceGitContentUri(c, i + 1, commitCount, c.originalFileName, decoration);
            locations.push(new Location(uri, new Position(0, 0)));
            if (c.sha === selectedSha) {
                locations.push(new Location(uri, new Position((line || 0) + 1, 0)));
            }
        });

        return locations;
    }

    async getBranch(repoPath: string): Promise<GitBranch | undefined> {
        Logger.log(`getBranch('${repoPath}')`);

        const data = await Git.branch(repoPath, false);
        const branches = data.split('\n').filter(_ => !!_).map(_ => new GitBranch(_));
        return branches.find(_ => _.current);
    }

    async getBranches(repoPath: string): Promise<GitBranch[]> {
        Logger.log(`getBranches('${repoPath}')`);

        const data = await Git.branch(repoPath, true);
        const branches = data.split('\n').filter(_ => !!_).map(_ => new GitBranch(_));
        return branches;
    }

    getCacheEntryKey(fileName: string) {
        return Git.normalizePath(fileName).toLowerCase();
    }

    async getConfig(key: string, repoPath?: string): Promise<string> {
        Logger.log(`getConfig('${key}', '${repoPath}')`);

        return await Git.config_get(key, repoPath);
    }

    getGitUriForFile(fileName: string) {
        const cacheKey = this.getCacheEntryKey(fileName);
        const entry = this._uriCache.get(cacheKey);
        return entry && entry.uri;
    }

    async getDiffForFile(repoPath: string | undefined, fileName: string, sha1?: string, sha2?: string): Promise<IGitDiff | undefined> {
        let key = 'diff';
        if (sha1 !== undefined) {
            key += `:${sha1}`;
        }
        if (sha2 !== undefined) {
            key += `:${sha2}`;
        }

        let entry: GitCacheEntry | undefined;
        if (this.UseCaching) {
            const cacheKey = this.getCacheEntryKey(fileName);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined) {
                const cachedDiff = entry.get<ICachedDiff>(key);
                if (cachedDiff !== undefined) {
                    Logger.log(`Cached(${key}): getDiffForFile('${repoPath}', '${fileName}', ${sha1}, ${sha2})`);
                    return cachedDiff.item;
                }
            }

            Logger.log(`Not Cached(${key}): getDiffForFile('${repoPath}', '${fileName}', ${sha1}, ${sha2})`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getDiffForFile('${repoPath}', '${fileName}', ${sha1}, ${sha2})`);
        }

        const promise = this._getDiffForFile(repoPath, fileName, sha1, sha2, entry, key);

        if (entry) {
            Logger.log(`Add log cache for '${entry.key}:${key}'`);

            entry.set<ICachedDiff>(key, {
                item: promise
            } as ICachedDiff);
        }

        return promise;
    }

    private async _getDiffForFile(repoPath: string | undefined, fileName: string, sha1: string | undefined, sha2: string | undefined, entry: GitCacheEntry | undefined, key: string): Promise<IGitDiff | undefined> {
        const [file, root] = Git.splitPath(fileName, repoPath, false);

        try {
            const data = await Git.diff(root, file, sha1, sha2);
            return GitDiffParser.parse(data, this.config.debug);
        }
        catch (ex) {
            // Trap and cache expected diff errors
            if (entry) {
                const msg = ex && ex.toString();
                Logger.log(`Replace diff cache with empty promise for '${entry.key}:${key}'`);

                entry.set<ICachedDiff>(key, {
                    item: GitService.EmptyPromise,
                    errorMessage: msg
                } as ICachedDiff);

                return await GitService.EmptyPromise as IGitDiff;
            }

            return undefined;
        }
    }

    async getDiffForLine(repoPath: string | undefined, fileName: string, line: number, sha1?: string, sha2?: string): Promise<[string | undefined, string | undefined] | undefined> {
        try {
            const diff = await this.getDiffForFile(repoPath, fileName, sha1, sha2);
            if (diff === undefined) return undefined;

            const chunk = diff.chunks.find(_ => Math.min(_.originalStart, _.changesStart) <= line && Math.max(_.originalEnd, _.changesEnd) >= line);
            if (chunk === undefined) return undefined;

            return [
                chunk.original[line - chunk.originalStart + 1],
                chunk.changes[line - chunk.changesStart + 1]
            ];
        }
        catch (ex) {
            return undefined;
        }
    }

    async getLogCommit(repoPath: string | undefined, fileName: string, options?: { firstIfMissing?: boolean, previous?: boolean }): Promise<GitLogCommit | undefined>;
    async getLogCommit(repoPath: string | undefined, fileName: string, sha: string | undefined, options?: { firstIfMissing?: boolean, previous?: boolean }): Promise<GitLogCommit | undefined>;
    async getLogCommit(repoPath: string | undefined, fileName: string, shaOrOptions?: string | undefined | { firstIfMissing?: boolean, previous?: boolean }, options?: { firstIfMissing?: boolean, previous?: boolean }): Promise<GitLogCommit | undefined> {
        let sha: string | undefined = undefined;
        if (typeof shaOrOptions === 'string') {
            sha = shaOrOptions;
        }
        else if (!options) {
            options = shaOrOptions;
        }

        options = options || {};

        const log = await this.getLogForFile(repoPath, fileName, sha, options.previous ? 2 : 1);
        if (!log) return undefined;

        const commit = sha && log.commits.get(sha);
        if (!commit && sha && !options.firstIfMissing) return undefined;

        return commit || Iterables.first(log.commits.values());
    }

    async getLogForRepo(repoPath: string, sha?: string, maxCount?: number, reverse: boolean = false): Promise<IGitLog | undefined> {
        Logger.log(`getLogForRepo('${repoPath}', ${sha}, ${maxCount})`);

        if (maxCount == null) {
            maxCount = this.config.advanced.maxQuickHistory || 0;
        }

        try {
            const data = await Git.log(repoPath, sha, maxCount, reverse);
            return GitLogParser.parse(data, 'branch', repoPath, undefined, sha, maxCount, reverse, undefined);
        }
        catch (ex) {
            return undefined;
        }
    }

    async getLogForRepoSearch(repoPath: string, search: string, searchBy: GitRepoSearchBy, maxCount?: number): Promise<IGitLog | undefined> {
        Logger.log(`getLogForRepoSearch('${repoPath}', ${search}, ${searchBy}, ${maxCount})`);

        if (maxCount == null) {
            maxCount = this.config.advanced.maxQuickHistory || 0;
        }

        let searchArgs: string[] | undefined = undefined;
        switch (searchBy) {
            case GitRepoSearchBy.Author:
                searchArgs = [`--author=${search}`];
                break;
            case GitRepoSearchBy.Files:
                searchArgs = [`--`, `${search}`];
                break;
            case GitRepoSearchBy.Message:
                searchArgs = [`--grep=${search}`];
                break;
            case GitRepoSearchBy.Sha:
                searchArgs = [search];
                maxCount = 1;
                break;
        }

        try {
            const data = await Git.log_search(repoPath, searchArgs, maxCount);
            return GitLogParser.parse(data, 'branch', repoPath, undefined, undefined, maxCount, false, undefined);
        }
        catch (ex) {
            return undefined;
        }
    }

    async getLogForFile(repoPath: string | undefined, fileName: string, sha?: string, maxCount?: number, range?: Range, reverse: boolean = false): Promise<IGitLog | undefined> {
        let key = 'log';
        if (sha !== undefined) {
            key += `:${sha}`;
        }
        if (maxCount !== undefined) {
            key += `:n${maxCount}`;
        }

        let entry: GitCacheEntry | undefined;
        if (this.UseCaching && range === undefined && !reverse) {
            const cacheKey = this.getCacheEntryKey(fileName);
            entry = this._gitCache.get(cacheKey);

            if (entry !== undefined) {
                const cachedLog = entry.get<ICachedLog>(key);
                if (cachedLog !== undefined) {
                    Logger.log(`Cached(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${maxCount}, undefined, false)`);
                    return cachedLog.item;
                }

                if (key !== 'log') {
                    // Since we are looking for partial log, see if we have the log of the whole file
                    const cachedLog = entry.get<ICachedLog>('log');
                    if (cachedLog !== undefined) {
                        if (sha === undefined) {
                            Logger.log(`Cached(~${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${maxCount}, undefined, false)`);
                            return cachedLog.item;
                        }

                        Logger.log(`? Cache(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${maxCount}, undefined, false)`);
                        const log = await cachedLog.item;
                        if (log !== undefined && log.commits.has(sha)) {
                            Logger.log(`Cached(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${maxCount}, undefined, false)`);
                            return cachedLog.item;
                        }
                    }
                }
            }

            Logger.log(`Not Cached(${key}): getLogForFile('${repoPath}', '${fileName}', ${sha}, ${maxCount}, undefined, false)`);

            if (entry === undefined) {
                entry = new GitCacheEntry(cacheKey);
                this._gitCache.set(entry.key, entry);
            }
        }
        else {
            Logger.log(`getLogForFile('${repoPath}', '${fileName}', ${sha}, ${maxCount}, ${range && `[${range.start.line}, ${range.end.line}]`}, ${reverse})`);
        }

        const promise = this._getLogForFile(repoPath, fileName, sha, range, maxCount, reverse, entry, key);

        if (entry) {
            Logger.log(`Add log cache for '${entry.key}:${key}'`);

            entry.set<ICachedLog>(key, {
                item: promise
            } as ICachedLog);
        }

        return promise;
    }

    private async _getLogForFile(repoPath: string | undefined, fileName: string, sha: string | undefined, range: Range | undefined, maxCount: number | undefined, reverse: boolean, entry: GitCacheEntry | undefined, key: string): Promise<IGitLog | undefined> {
        const [file, root] = Git.splitPath(fileName, repoPath, false);

        const ignore = await this._gitignore;
        if (ignore && !ignore.filter([file]).length) {
            Logger.log(`Skipping log; '${fileName}' is gitignored`);
            return await GitService.EmptyPromise as IGitLog;
        }

        try {
            const data = await Git.log_file(root, file, sha, maxCount, reverse, range && range.start.line + 1, range && range.end.line + 1);
            return GitLogParser.parse(data, 'file', root, file, sha, maxCount, reverse, range);
        }
        catch (ex) {
            // Trap and cache expected log errors
            if (entry) {
                const msg = ex && ex.toString();
                Logger.log(`Replace log cache with empty promise for '${entry.key}:${key}'`);

                entry.set<ICachedLog>(key, {
                    item: GitService.EmptyPromise,
                    errorMessage: msg
                } as ICachedLog);

                return await GitService.EmptyPromise as IGitLog;
            }

            return undefined;
        }
    }

    async getLogLocations(uri: GitUri, selectedSha?: string, line?: number): Promise<Location[] | undefined> {
        Logger.log(`getLogLocations('${uri.repoPath}', '${uri.fsPath}', ${uri.sha}, ${selectedSha}, ${line})`);

        const log = await this.getLogForFile(uri.repoPath, uri.fsPath, uri.sha);
        if (!log) return undefined;

        const commitCount = log.commits.size;

        const locations: Location[] = [];
        Iterables.forEach(log.commits.values(), (c, i) => {
            if (c.isUncommitted) return;

            const decoration = `\u2937 ${c.author}, ${moment(c.date).format('MMMM Do, YYYY h:MMa')}`;
            const uri = GitService.toReferenceGitContentUri(c, i + 1, commitCount, c.originalFileName, decoration);
            locations.push(new Location(uri, new Position(0, 0)));
            if (c.sha === selectedSha) {
                locations.push(new Location(uri, new Position((line || 0) + 1, 0)));
            }
        });

        return locations;
    }

    async getRemotes(repoPath: string): Promise<GitRemote[]> {
        if (!repoPath) return [];

        Logger.log(`getRemotes('${repoPath}')`);

        if (this.UseCaching) {
            const remotes = this._remotesCache.get(repoPath);
            if (remotes !== undefined) return remotes;
        }

        const data = await Git.remote(repoPath);
        const remotes = data.split('\n').filter(_ => !!_).map(_ => new GitRemote(_));
        if (this.UseCaching) {
            this._remotesCache.set(repoPath, remotes);
        }
        return remotes;
    }

    getRepoPath(cwd: string): Promise<string> {
        return GitService.getRepoPath(cwd);
    }

    async getRepoPathFromFile(fileName: string): Promise<string | undefined> {
        const log = await this.getLogForFile(undefined, fileName, undefined, 1);
        if (log === undefined) return undefined;

        return log.repoPath;
    }

    async getRepoPathFromUri(uri: Uri | undefined): Promise<string | undefined> {
        if (!(uri instanceof Uri)) return this.repoPath;

        const repoPath = (await GitUri.fromUri(uri, this)).repoPath;
        if (!repoPath) return this.repoPath;

        return repoPath;
    }

    async getStashList(repoPath: string): Promise<IGitStash | undefined> {
        Logger.log(`getStash('${repoPath}')`);

        const data = await Git.stash_list(repoPath);
        return GitStashParser.parse(data, repoPath);
    }

    async getStatusForFile(repoPath: string, fileName: string): Promise<GitStatusFile | undefined> {
        Logger.log(`getStatusForFile('${repoPath}', '${fileName}')`);

        const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

        const data = await Git.status_file(repoPath, fileName, porcelainVersion);
        const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
        if (status === undefined || !status.files.length) return undefined;

        return status.files[0];
    }

    async getStatusForRepo(repoPath: string): Promise<IGitStatus | undefined> {
        Logger.log(`getStatusForRepo('${repoPath}')`);

        const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

        const data = await Git.status(repoPath, porcelainVersion);
        return GitStatusParser.parse(data, repoPath, porcelainVersion);
    }

    async getVersionedFile(repoPath: string | undefined, fileName: string, sha: string) {
        Logger.log(`getVersionedFile('${repoPath}', '${fileName}', ${sha})`);

        const file = await Git.getVersionedFile(repoPath, fileName, sha);
        const cacheKey = this.getCacheEntryKey(file);
        const entry = new UriCacheEntry(new GitUri(Uri.file(fileName), { sha, repoPath: repoPath!, fileName }));
        this._uriCache.set(cacheKey, entry);
        return file;
    }

    getVersionedFileText(repoPath: string, fileName: string, sha: string) {
        Logger.log(`getVersionedFileText('${repoPath}', '${fileName}', ${sha})`);

        return Git.show(repoPath, fileName, sha);
    }

    hasGitUriForFile(editor: TextEditor): boolean;
    hasGitUriForFile(fileName: string): boolean;
    hasGitUriForFile(fileNameOrEditor: string | TextEditor): boolean {
        let fileName: string;
        if (typeof fileNameOrEditor === 'string') {
            fileName = fileNameOrEditor;
        }
        else {
            if (!fileNameOrEditor || !fileNameOrEditor.document || !fileNameOrEditor.document.uri) return false;
            fileName = fileNameOrEditor.document.uri.fsPath;
        }

        const cacheKey = this.getCacheEntryKey(fileName);
        return this._uriCache.has(cacheKey);
    }

    isEditorBlameable(editor: TextEditor): boolean {
        return (editor.viewColumn !== undefined || this.isTrackable(editor.document.uri) || this.hasGitUriForFile(editor));
    }

    async isFileUncommitted(uri: GitUri): Promise<boolean> {
        Logger.log(`isFileUncommitted('${uri.repoPath}', '${uri.fsPath}')`);

        const status = await this.getStatusForFile(uri.repoPath!, uri.fsPath);
        return !!status;
    }

    isTrackable(uri: Uri): boolean {
        // Logger.log(`isTrackable('${uri.scheme}', '${uri.fsPath}')`);

        return uri.scheme === DocumentSchemes.File || uri.scheme === DocumentSchemes.Git || uri.scheme === DocumentSchemes.GitLensGit;
    }

    async isTracked(uri: GitUri): Promise<boolean> {
        if (!this.isTrackable(uri)) return false;

        Logger.log(`isTracked('${uri.fsPath}', '${uri.repoPath}')`);

        const result = await Git.ls_files(uri.repoPath === undefined ? '' : uri.repoPath, uri.fsPath);
        return !!result;
    }

    openDirectoryDiff(repoPath: string, sha1: string, sha2?: string) {
        Logger.log(`openDirectoryDiff('${repoPath}', ${sha1}, ${sha2})`);

        return Git.difftool_dirDiff(repoPath, sha1, sha2);
    }

    stashApply(repoPath: string, stashName: string, deleteAfter: boolean = false) {
        Logger.log(`stashApply('${repoPath}', ${stashName}, ${deleteAfter})`);

        return Git.stash_apply(repoPath, stashName, deleteAfter);
    }

    stashDelete(repoPath: string, stashName: string) {
        Logger.log(`stashDelete('${repoPath}', ${stashName}})`);

        return Git.stash_delete(repoPath, stashName);
    }

    stashSave(repoPath: string, message?: string, unstagedOnly: boolean = false) {
        Logger.log(`stashSave('${repoPath}', ${message}, ${unstagedOnly})`);

        return Git.stash_save(repoPath, message, unstagedOnly);
    }

    toggleCodeLens(editor: TextEditor) {
        if (this.config.codeLens.visibility === CodeLensVisibility.Off ||
            (!this.config.codeLens.recentChange.enabled && !this.config.codeLens.authors.enabled)) return;

        Logger.log(`toggleCodeLens()`);
        if (this._codeLensProviderDisposable) {
            this._codeLensProviderDisposable.dispose();
            this._codeLensProviderDisposable = undefined;
            return;
        }

        this._codeLensProviderDisposable = languages.registerCodeLensProvider(GitCodeLensProvider.selector, new GitCodeLensProvider(this.context, this));
    }

    static getGitPath(gitPath?: string): Promise<IGit> {
        return Git.getGitPath(gitPath);
    }

    static getGitVersion(): string {
        return Git.gitInfo().version;
    }

    static async getRepoPath(cwd: string | undefined): Promise<string> {
        const repoPath = await Git.getRepoPath(cwd);
        if (!repoPath) return '';

        return repoPath;
    }

    static fromGitContentUri(uri: Uri): IGitUriData {
        if (uri.scheme !== DocumentSchemes.GitLensGit) throw new Error(`fromGitUri(uri=${uri}) invalid scheme`);
        return GitService._fromGitContentUri<IGitUriData>(uri);
    }

    private static _fromGitContentUri<T extends IGitUriData>(uri: Uri): T {
        return JSON.parse(uri.query) as T;
    }

    static isSha(sha: string): boolean {
        return Git.isSha(sha);
    }

    static isUncommitted(sha: string): boolean {
        return Git.isUncommitted(sha);
    }

    static normalizePath(fileName: string, repoPath?: string): string {
        return Git.normalizePath(fileName, repoPath);
    }

    static toGitContentUri(sha: string, shortSha: string, fileName: string, repoPath: string, originalFileName?: string): Uri;
    static toGitContentUri(commit: GitCommit): Uri;
    static toGitContentUri(shaOrcommit: string | GitCommit, shortSha?: string, fileName?: string, repoPath?: string, originalFileName?: string): Uri {
        let data: IGitUriData;
        if (typeof shaOrcommit === 'string') {
            data = GitService._toGitUriData({
                sha: shaOrcommit,
                fileName: fileName!,
                repoPath: repoPath!,
                originalFileName: originalFileName
            });
        }
        else {
            data = GitService._toGitUriData(shaOrcommit, undefined, shaOrcommit.originalFileName);
            fileName = shaOrcommit.fileName;
            shortSha = shaOrcommit.shortSha;
        }

        const extension = path.extname(fileName!);
        return Uri.parse(`${DocumentSchemes.GitLensGit}:${path.basename(fileName!, extension)}:${shortSha}${extension}?${JSON.stringify(data)}`);
    }

    static toReferenceGitContentUri(commit: GitCommit, index: number, commitCount: number, originalFileName?: string, decoration?: string): Uri {
        return GitService._toReferenceGitContentUri(commit, DocumentSchemes.GitLensGit, commitCount, GitService._toGitUriData(commit, index, originalFileName, decoration));
    }

    private static _toReferenceGitContentUri(commit: GitCommit, scheme: DocumentSchemes, commitCount: number, data: IGitUriData) {
        const pad = (n: number) => ('0000000' + n).slice(-('' + commitCount).length);
        const ext = path.extname(data.fileName);
        const uriPath = `${path.relative(commit.repoPath, data.fileName.slice(0, -ext.length))}/${commit.shortSha}${ext}`;

        let message = commit.message;
        if (message.length > 50) {
            message = message.substring(0, 49) + '\u2026';
        }

        // NOTE: Need to specify an index here, since I can't control the sort order -- just alphabetic or by file location
        return Uri.parse(`${scheme}:${pad(data.index || 0)} \u2022 ${encodeURIComponent(message)} \u2022 ${moment(commit.date).format('MMM D, YYYY hh:MMa')} \u2022 ${encodeURIComponent(uriPath)}?${JSON.stringify(data)}`);
    }

    private static _toGitUriData<T extends IGitUriData>(commit: IGitUriData, index?: number, originalFileName?: string, decoration?: string): T {
        const fileName = Git.normalizePath(path.resolve(commit.repoPath, commit.fileName));
        const data = { repoPath: commit.repoPath, fileName: fileName, sha: commit.sha, index: index } as T;
        if (originalFileName) {
            data.originalFileName = Git.normalizePath(path.resolve(commit.repoPath, originalFileName));
        }
        if (decoration) {
            data.decoration = decoration;
        }
        return data;
    }

    static validateGitVersion(major: number, minor: number): boolean {
        const [gitMajor, gitMinor] = this.getGitVersion().split('.');
        return (parseInt(gitMajor, 10) >= major && parseInt(gitMinor, 10) >= minor);
    }
}