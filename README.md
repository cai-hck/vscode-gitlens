# GitLens

Provides Git information (most recent commit, # of authors) in CodeLens, on-demand inline blame annotations, status bar blame information, a blame explorer, and commands to compare changes with the working tree or previous versions.

---
## Features

- Provides **CodeLens** on code blocks:
  - **Recent Change** - author and date of the most recent check-in for that block
    > Clicking on the CodeLens opens a **Blame history explorer** with the commits and changed lines in the right pane and the commit (file) contents on the left
  - **Authors** - number of authors of a block and the most prominent author (if there are more than one)
    > Clicking on the CodeLens toggles Git blame annotations on/off
- Provides on-demand **inline blame annotations** with multiple styles
- Provides Git blame information about the selected line in the **status bar**
- Provides a Git **history explorer** to visualize the history of a file or block
- Provides a Git **blame history explorer** to visualize the blame history of a file or block
- Provides ability to **compare diffs** with the working tree as well as with previous versions
- Provides many configuration settings to allow the **customization** of almost all features

---
## Screenshots

> ![GitLens preview](https://raw.githubusercontent.com/eamodio/vscode-git-codelens/master/images/preview-gitlens.gif)

---
## Requirements

Must be using Git and it must be in your path.

---
## Extension Settings

|Name | Description
|-----|------------
|`gitlens.blame.annotation.style`|Specifies the style of the blame annotations. `compact` - groups annotations to limit the repetition and also adds author and date when possible. `expanded` - shows an annotation on every line
|`gitlens.blame.annotation.sha`|Specifies whether the commit sha will be shown in the blame annotations. Applies only to the `expanded` annotation style
|`gitlens.blame.annotation.author`|Specifies whether the committer will be shown in the blame annotations. Applies only to the `expanded` annotation style
|`gitlens.blame.annotation.date`|Specifies whether the commit date will be shown in the blame annotations. Applies only to the `expanded` annotation style
|`gitlens.codeLens.visibility`|Specifies when CodeLens will be triggered in the active document. `auto` - automatically. `ondemand` - only when requested. `off` - disables all active document CodeLens
|`gitlens.codeLens.location`|Specifies where CodeLens will be rendered in the active document. `all` - render at the top of the document, on container-like (classes, modules, etc), and on member-like (methods, functions, properties, etc) lines. `document+containers` - render at the top of the document and on container-like lines. `document` - only render at the top of the document. `custom` - rendering controlled by `gitlens.codeLens.locationCustomSymbols`
|`gitlens.codeLens.locationCustomSymbols`|Specifies the set of document symbols to render active document CodeLens on. Must be a member of `SymbolKind`
|`gitlens.codeLens.languageLocations`|Specifies where CodeLens will be rendered in the active document for the specified languages
|`gitlens.codeLens.recentChange.enabled`|Specifies whether the recent change CodeLens is shown
|`gitlens.codeLens.recentChange.command`|Specifies the command executed when the recent change CodeLens is clicked.  `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current checked-in file with the previous commit. `git.viewFileHistory` - opens a file history picker, which requires the Git History (git log) extension
|`gitlens.codeLens.authors.enabled`|Specifies whether the authors CodeLens is shown
|`gitlens.codeLens.authors.command`|Specifies the command executed when the authors CodeLens is clicked.  `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current checked-in file with the previous commit. `git.viewFileHistory` - opens a file history picker, which requires the Git History (git log) extension
|`gitlens.menus.fileDiff.enabled`|Specifies whether file-based diff commands will be added to the context menus
|`gitlens.menus.lineDiff.enabled`|Specifies whether line-based diff commands will be added to the context menus
|`gitlens.statusBar.enabled`|Specifies whether blame information is shown in the status bar
|`gitlens.statusBar.command`|"Specifies the command executed when the blame status bar item is clicked. `gitlens.toggleBlame` - toggles blame annotations. `gitlens.showBlameHistory` - opens the blame history explorer. `gitlens.showFileHistory` - opens the file history explorer. `gitlens.diffWithPrevious` - compares the current checked-in file with the previous commit. `git.viewFileHistory` - opens a file history picker, which requires the Git History (git log) extension"

---
## Known Issues

- Content in the **history explorers** disappears after a bit: [vscode issue](https://github.com/Microsoft/vscode/issues/11360)
- Highlighted lines disappear in **Blame explorer** after changing selection and returning to a previous selection: [vscode issue](https://github.com/Microsoft/vscode/issues/11360)
- CodeLens aren't updated properly after a file is saved: [vscode issue](https://github.com/Microsoft/vscode/issues/11546)
- Visible whitespace causes issue with blame overlay (currently fixed with a hack, but fails randomly): [vscode issue](https://github.com/Microsoft/vscode/issues/11485)