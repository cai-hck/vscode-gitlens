import {
    DecorationInstanceRenderOptions,
    DecorationOptions,
    MarkdownString,
    ThemableDecorationAttachmentRenderOptions,
    ThemableDecorationRenderOptions,
    ThemeColor,
    workspace
} from 'vscode';
import { DiffWithCommand, ShowQuickCommitDetailsCommand } from '../commands';
import { FileAnnotationType } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import {
    CommitFormatOptions,
    CommitFormatter,
    GitBlameCommit,
    GitCommit,
    GitDiffHunkLine,
    GitRemote,
    GitService,
    GitUri
} from '../git/gitService';
import { Objects, Strings } from '../system';
import { toRgba } from '../webviews/apps/shared/colors';

export interface ComputedHeatmap {
    cold: boolean;
    colors: { hot: string; cold: string };
    median: number;
    newest: number;
    oldest: number;
    computeAge(date: Date): number;
}

interface HeatmapConfig {
    enabled: boolean;
    location?: 'left' | 'right';
}

interface RenderOptions
    extends DecorationInstanceRenderOptions,
        ThemableDecorationRenderOptions,
        ThemableDecorationAttachmentRenderOptions {
    height?: string;
    uncommittedColor?: string | ThemeColor;
}

const defaultHeatmapHotColor = '#f66a0a';
const defaultHeatmapColdColor = '#0a60f6';

let computedHeatmapColor: {
    color: string;
    rgb: string;
};

export class Annotations {
    static applyHeatmap(decoration: Partial<DecorationOptions>, date: Date, heatmap: ComputedHeatmap) {
        const color = this.getHeatmapColor(date, heatmap);
        decoration.renderOptions!.before!.borderColor = color;
    }

    private static getHeatmapColor(date: Date, heatmap: ComputedHeatmap) {
        const baseColor = heatmap.cold ? heatmap.colors.cold : heatmap.colors.hot;

        const age = heatmap.computeAge(date);
        if (age === 0) return baseColor;

        if (computedHeatmapColor === undefined || computedHeatmapColor.color !== baseColor) {
            let rgba = toRgba(baseColor);
            if (rgba == null) {
                rgba = toRgba(heatmap.cold ? defaultHeatmapColdColor : defaultHeatmapHotColor)!;
            }

            const [r, g, b] = rgba;
            computedHeatmapColor = {
                color: baseColor,
                rgb: `${r}, ${g}, ${b}`
            };
        }

        return `rgba(${computedHeatmapColor.rgb}, ${(1 - age / 10).toFixed(2)})`;
    }

    static getHoverMessage(
        commit: GitCommit,
        dateFormat: string | null,
        remotes: GitRemote[],
        annotationType?: FileAnnotationType,
        line: number = 0
    ): MarkdownString {
        if (dateFormat === null) {
            dateFormat = 'MMMM Do, YYYY h:mma';
        }

        const markdown = new MarkdownString(
            CommitFormatter.fromTemplate(Container.config.hovers.detailsMarkdownFormat, commit, {
                annotationType: annotationType,
                dateFormat: dateFormat,
                line: line,
                markdown: true,
                remotes: remotes
            })
        );
        markdown.isTrusted = true;
        return markdown;
    }

    static getHoverDiffMessage(
        commit: GitCommit,
        uri: GitUri,
        hunkLine: GitDiffHunkLine | undefined,
        editorLine?: number
    ): MarkdownString | undefined {
        if (hunkLine === undefined || commit.previousSha === undefined) return undefined;

        const diff = this.getDiffFromHunkLine(hunkLine);

        let message: string;
        if (commit.isUncommitted) {
            if (uri.sha !== undefined && GitService.isStagedUncommitted(uri.sha)) {
                message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(
                    commit,
                    editorLine
                )} "Open Changes") &nbsp; ${GlyphChars.Dash} &nbsp; [\`${
                    commit.previousShortSha
                }\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
                    commit.previousSha!
                )} "Show Commit Details") ${GlyphChars.ArrowLeftRightLong} _${uri.shortSha}_\n${diff}`;
            }
            else {
                message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(
                    commit,
                    editorLine
                )} "Open Changes") &nbsp; ${GlyphChars.Dash} &nbsp; _uncommitted changes_\n${diff}`;
            }
        }
        else {
            message = `[\`Changes\`](${DiffWithCommand.getMarkdownCommandArgs(
                commit,
                editorLine
            )} "Open Changes") &nbsp; ${GlyphChars.Dash} &nbsp; [\`${
                commit.previousShortSha
            }\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(commit.previousSha!)} "Show Commit Details") ${
                GlyphChars.ArrowLeftRightLong
            } [\`${commit.shortSha}\`](${ShowQuickCommitDetailsCommand.getMarkdownCommandArgs(
                commit.sha
            )} "Show Commit Details")\n${diff}`;
        }

        const markdown = new MarkdownString(message);
        markdown.isTrusted = true;
        return markdown;
    }

    private static getDiffFromHunkLine(hunkLine: GitDiffHunkLine): string {
        if (Container.config.hovers.changesDiff === 'hunk') {
            return `\`\`\`diff\n${hunkLine.hunk.diff}\n\`\`\``;
        }

        return `\`\`\`diff${hunkLine.previous === undefined ? '' : `\n-${hunkLine.previous.line}`}${
            hunkLine.current === undefined ? '' : `\n+${hunkLine.current.line}`
        }\n\`\`\``;
    }

    static async changesHover(
        commit: GitBlameCommit,
        editorLine: number,
        uri: GitUri
    ): Promise<Partial<DecorationOptions>> {
        let ref;
        if (commit.isUncommitted) {
            if (uri.sha !== undefined && GitService.isStagedUncommitted(uri.sha)) {
                ref = uri.sha;
            }
        }
        else {
            ref = commit.sha;
        }

        const line = editorLine + 1;
        const commitLine = commit.lines.find(l => l.line === line) || commit.lines[0];

        const commitEditorLine = commitLine.originalLine - 1;
        const hunkLine = await Container.git.getDiffForLine(uri, commitEditorLine, ref);
        const message = this.getHoverDiffMessage(commit, uri, hunkLine, commitEditorLine);

        return {
            hoverMessage: message
        };
    }

    // static detailsHover(commit: GitCommit, dateFormat: string | null, hasRemote: boolean, annotationType?: FileAnnotationType, line: number = 0): DecorationOptions {
    //     const message = this.getHoverMessage(commit, dateFormat, hasRemote, annotationType);
    //     return {
    //         hoverMessage: message
    //     } as DecorationOptions;
    // }

    static gutter(
        commit: GitCommit,
        format: string,
        dateFormatOrFormatOptions: string | null | CommitFormatOptions,
        renderOptions: RenderOptions
    ): Partial<DecorationOptions> {
        const decoration: Partial<DecorationOptions> = {
            renderOptions: {
                before: { ...renderOptions }
            }
        };

        if (commit.isUncommitted) {
            decoration.renderOptions!.before!.color = renderOptions.uncommittedColor;
        }

        const message = CommitFormatter.fromTemplate(format, commit, dateFormatOrFormatOptions);
        decoration.renderOptions!.before!.contentText = Strings.pad(message.replace(/ /g, GlyphChars.Space), 1, 1);

        return decoration;
    }

    static gutterRenderOptions(
        separateLines: boolean,
        heatmap: HeatmapConfig,
        format: string,
        options: CommitFormatOptions
    ): RenderOptions {
        // Get the character count of all the tokens, assuming there there is a cap (bail if not)
        let chars = 0;
        for (const token of Objects.values(options.tokenOptions!)) {
            if (token === undefined) continue;

            // If any token is uncapped, kick out and set no max
            if (token.truncateTo == null) {
                chars = -1;
                break;
            }

            chars += token.truncateTo;
        }

        if (chars >= 0) {
            // Add the chars of the template string (without tokens)
            chars += Strings.getWidth(Strings.interpolate(format, undefined));
            // If we have chars, add a bit of padding
            if (chars > 0) {
                chars += 3;
            }
        }

        let borderStyle = undefined;
        let borderWidth = undefined;
        if (heatmap.enabled) {
            borderStyle = 'solid';
            borderWidth = heatmap.location === 'left' ? '0 0 0 2px' : '0 2px 0 0';
        }

        let width;
        if (chars >= 0) {
            const spacing = workspace.getConfiguration('editor').get<number>('letterSpacing');
            if (spacing != null && spacing !== 0) {
                width = `calc(${chars}ch + ${Math.round(chars * spacing)}px)`;
            }
            else {
                width = `${chars}ch`;
            }
        }

        return {
            backgroundColor: new ThemeColor('gitlens.gutterBackgroundColor'),
            borderStyle: borderStyle,
            borderWidth: borderWidth,
            color: new ThemeColor('gitlens.gutterForegroundColor'),
            fontWeight: 'normal',
            fontStyle: 'normal',
            height: '100%',
            margin: '0 26px -1px 0',
            textDecoration: separateLines ? 'overline solid rgba(0, 0, 0, .2)' : 'none',
            width: width,
            uncommittedColor: new ThemeColor('gitlens.gutterUncommittedForegroundColor')
        };
    }

    static heatmap(
        commit: GitCommit,
        heatmap: ComputedHeatmap,
        renderOptions: RenderOptions
    ): Partial<DecorationOptions> {
        const decoration: Partial<DecorationOptions> = {
            renderOptions: {
                before: { ...renderOptions }
            }
        };

        Annotations.applyHeatmap(decoration, commit.date, heatmap);

        return decoration;
    }

    static heatmapRenderOptions(): RenderOptions {
        return {
            borderStyle: 'solid',
            borderWidth: '0 0 0 2px'
        };
    }

    // static hover(commit: GitCommit, renderOptions: IRenderOptions, now: number): DecorationOptions {
    //     const decoration = {
    //         renderOptions: { before: { ...renderOptions } }
    //     } as DecorationOptions;

    //     this.applyHeatmap(decoration, commit.date, now);

    //     return decoration;
    // }

    // static hoverRenderOptions(heatmap: HeatmapConfig): IRenderOptions {
    //     if (!heatmap.enabled) return { before: undefined };

    //     return {
    //         borderStyle: 'solid',
    //         borderWidth: '0 0 0 2px',
    //         contentText: GlyphChars.ZeroWidthSpace,
    //         height: '100%',
    //         margin: '0 26px 0 0',
    //         textDecoration: 'none'
    //     } as IRenderOptions;
    // }

    static trailing(
        commit: GitCommit,
        format: string,
        dateFormat: string | null,
        scrollable: boolean = true
    ): Partial<DecorationOptions> {
        const message = CommitFormatter.fromTemplate(format, commit, {
            truncateMessageAtNewLine: true,
            dateFormat: dateFormat
        });

        return {
            renderOptions: {
                after: {
                    backgroundColor: new ThemeColor('gitlens.trailingLineBackgroundColor'),
                    color: new ThemeColor('gitlens.trailingLineForegroundColor'),
                    contentText: Strings.pad(message.replace(/ /g, GlyphChars.Space), 1, 1),
                    fontWeight: 'normal',
                    fontStyle: 'normal',
                    // Pull the decoration out of the document flow if we want to be scrollable
                    textDecoration: `none;${scrollable ? '' : ' position: absolute;'}`
                }
            }
        };
    }

    // static withRange(decoration: DecorationOptions, start?: number, end?: number): DecorationOptions {
    //     let range = decoration.range;
    //     if (start !== undefined) {
    //         range = range.with({
    //             start: range.start.with({ character: start })
    //         });
    //     }

    //     if (end !== undefined) {
    //         range = range.with({
    //             end: range.end.with({ character: end })
    //         });
    //     }

    //     return { ...decoration, range: range };
    // }
}
