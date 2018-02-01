'use strict';
import { DOM } from './../shared/dom';
import { initializeColorPalette } from '../shared/colors';
import { IConfig } from './../config';

const config: IConfig = (window as any).gitlens.config;

export class App {

    private readonly _commandRelay: HTMLAnchorElement;
    private readonly _changes: { [key: string]: any } = Object.create(null);

    constructor() {
        console.log('SettingsApp.ctor');

        this._commandRelay = DOM.getElementById<HTMLAnchorElement>('commandRelay');

        initializeColorPalette();
        this.initializeState();

        const onChecked = this.onChecked.bind(this);
        DOM.listenAll('input[type="checkbox"],input[type="radio"]', 'change', function(this: HTMLInputElement) { onChecked(this); });

        const onSelected = this.onSelected.bind(this);
        DOM.listenAll('select', 'change', function(this: HTMLInputElement) { onSelected(this); });
    }

    private onChecked(element: HTMLInputElement) {
        console.log(`SettingsApp.onChange: name=${element.name}, checked=${element.checked}, value=${element.value}`);

        if (!element.name.startsWith('!')) {
            let value;
            if (element.checked) {
                value = element.value === 'on' ? true : element.value;
            }
            else {
                value = false;
            }
            this._changes[element.name] = value;
        }

        this.setAdditionalSettings(element.checked ? element.dataset.addSettingsOn : element.dataset.addSettingsOff);
        this.updateState(this._changes);
        this.applyChanges();
    }

    private onSelected(element: HTMLSelectElement) {
        const value = element.options[element.selectedIndex].value;

        console.log(`SettingsApp.onSelected: name=${element.name}, value=${value}`);

        this._changes[element.name] = ensureIfBoolean(value);

        this.updateState(this._changes);
        this.applyChanges();
    }

    private applyChanges() {
        const args = JSON.stringify(this._changes);
        console.log(`SettingsApp.applyChanges: changes=${args}`);

        const command = 'command:gitlens.saveSettings?' + encodeURI(args);
        setTimeout(() => this.executeCommand(command), 0);
    }

    private executeCommand(command: string | undefined) {
        if (command === undefined) return;

        console.log(`SettingsApp.executeCommand: command=${command}`);

        this._commandRelay.setAttribute('href', command);
        this._commandRelay.click();
    }

    private initializeState() {
        console.log('SettingsApp.initializeState');

        const changes: { [key: string]: string | boolean } = Object.create(null);

        for (const el of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
            const name = el.name;

            const checked = name.startsWith('!') ? false : getSettingValue<boolean>(name);
            el.checked = checked;

            changes[name] = checked;
        }

        for (const el of document.querySelectorAll<HTMLSelectElement>('select')) {
            const name = el.name;

            const value = getSettingValue<string>(name);

            el.querySelector<HTMLOptionElement>(`option[value='${value}']`)!.selected = true;

            changes[name] = value;
        }

        this.updateState(changes);
    }

    private setAdditionalSettings(expression: string | undefined) {
        if (!expression) return;

        const addSettings = parseAdditionalSettingsExpression(expression);
        for (const [s, v] of addSettings) {
            this._changes[s] = v;
        }
    }

    private updateState(changes: { [key: string]: string | boolean }) {
        this.updateVisibility(changes);
        this.updateEnablement(changes);
    }

    private updateEnablement(changes: { [key: string]: string | boolean }) {
        const selectors = Object.keys(changes).map(c => `[data-enablement~="${c}"]`).join(',');
        for (const el of document.querySelectorAll<HTMLElement>(selectors)) {
            const enabled = evaluateStateExpression(el.dataset.enablement!, changes);
            if (enabled) {
                el.removeAttribute('disabled');
            }
            else {
                el.setAttribute('disabled', '');
            }

            if (el.matches('input,select')) {
                (el as HTMLInputElement | HTMLSelectElement).disabled = !enabled;
            }
            else {
                const input = el.querySelector<HTMLInputElement | HTMLSelectElement>('input,select');
                if (input == null) continue;

                input.disabled = !enabled;
            }
        }
    }

    private updateVisibility(changes: { [key: string]: string | boolean }) {
        const selectors = Object.keys(changes).map(c => `[data-visibility~="${c}"]`).join(',');
        for (const el of document.querySelectorAll<HTMLElement>(selectors)) {
            const visible = evaluateStateExpression(el.dataset.visibility!, changes);
            if (visible) {
                el.classList.remove('hidden');
            }
            else {
                el.classList.add('hidden');
            }
        }
    }
}

function ensureIfBoolean(value: string | boolean): string | boolean {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
}

function evaluateStateExpression(expression: string, changes: { [key: string]: string | boolean }): boolean {
    let state = false;
    for (const expr of expression.trim().split('&&')) {
        const [lhs, rhs] = parseStateExpression(expr);

        let value = changes[lhs];
        if (value === undefined) {
            value = getSettingValue<string | boolean>(lhs);
        }
        state = rhs !== undefined ? rhs === '' + value : !!value;

        if (!state) break;
    }
    return state;
}

function get<T>(o: { [key: string ]: any}, path: string): T {
    return path.split('.').reduce((o = {}, key) => o[key], o) as T;
}

function getSettingValue<T>(path: string): T {
    return get<T>(config, path);
}

function parseAdditionalSettingsExpression(expression: string): [string, string | boolean][] {
    const settingsExpression = expression.trim().split(',');
    return settingsExpression.map<[string, string | boolean]>(s => {
        const [setting, value] = s.split('=');
        return [setting, ensureIfBoolean(value)];
    });
}

function parseStateExpression(expression: string): [string, string | boolean | undefined] {
    const [lhs, rhs] = expression.trim().split('=');
    return [lhs.trim(), rhs !== undefined ? rhs.trim() : rhs];
}