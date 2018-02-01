'use strict';

export namespace DOM {
    export function getElementById<T extends HTMLElement>(id: string): T {
        return document.getElementById(id) as T;
    }

    // export function query<T extends HTMLElement>(selectors: string): T;
    // export function query<T extends HTMLElement>(element: HTMLElement, selectors: string): T;
    // export function query<T extends HTMLElement>(elementOrselectors: string | HTMLElement, selectors?: string): T {
    //     let element: Document | HTMLElement;
    //     if (typeof elementOrselectors === 'string') {
    //         element = document;
    //         selectors = elementOrselectors;
    //     }
    //     else {
    //         element = elementOrselectors;
    //     }

    //     return element.querySelector(selectors) as T;
    // }

    // export function queryAll<T extends Element>(selectors: string): T;
    // export function queryAll<T extends Element>(element: HTMLElement, selectors: string): T;
    // export function queryAll<T extends Element>(elementOrselectors: string | HTMLElement, selectors?: string): T {
    //     let element: Document | HTMLElement;
    //     if (typeof elementOrselectors === 'string') {
    //         element = document;
    //         selectors = elementOrselectors;
    //     }
    //     else {
    //         element = elementOrselectors;
    //     }

    //     return element.querySelectorAll(selectors) as NodeList<T>;
    // }

    export function listenAll(selector: string, name: string, listener: EventListenerOrEventListenerObject) {
        const els = document.querySelectorAll(selector);
        for (const el of els) {
            el.addEventListener(name, listener, false);
        }
    }
}