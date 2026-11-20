// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// Fuzzy matching for the menu's searches: an app, a Settings page or a file found though its name is misspelt
// ("frefox", "blutooth", "termnal"), shortened ("vsc" for Visual Studio Code) or typed in another order. Exact,
// starting and containing matches are found first, elsewhere (menu.js); this gives what is left a score, lower
// closer, or null (too far to show).

/** Lower case, accents taken off. */
export function fold(text) {
    return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The words of `text`, joined ones split too ("robustGreedy" → robust, greedy; "HTMLParser" → html, parser). */
const words = text => fold(String(text ?? '').replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2'))
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Edits allowed for a word of `length` letters: none for 1–2, then 1, 2 from 6, 3 from 10. */
const allowed = length => length <= 2 ? 0 : length <= 5 ? 1 : length <= 9 ? 2 : 3;

/** Edits (a letter added, taken out, changed, or two swapped) from `a` to `b`, or `max + 1` once past `max`. */
export function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max)
        return max + 1;
    let prev2 = null;
    let prev = Array.from({length: b.length + 1}, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        let best = row[0];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
            if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
                value = Math.min(value, prev2[j - 2] + 1);
            row.push(value);
            best = Math.min(best, value);
        }
        if (best > max)
            return max + 1;
        prev2 = prev;
        prev = row;
    }
    return prev[b.length];
}

/** How close one typed `term` is to one `word`: 0 starting it, the edits to it or to its start, null too far. */
function termToWord(term, word) {
    if (word.startsWith(term))
        return 0;
    const max = allowed(term.length);
    if (max === 0)
        return null;
    // The whole word ("termnal" for "terminal") or as much of it as was typed ("termn" for "terminal").
    // Its start as long as what was typed, a letter more or less (a letter left out or in twice).
    const whole = distance(term, word, max);
    let start = max + 1;
    for (const length of [term.length - 1, term.length, term.length + 1]) {
        if (length > 0 && length < word.length)
            start = Math.min(start, distance(term, word.slice(0, length), max));
    }
    const best = Math.min(whole, start);
    return best <= max ? best : null;
}

/** Whether `term`'s letters come in order as the starts of `textWords` ("vsc": Visual Studio Code). */
function initials(term, textWords) {
    if (term.length < 2 || term.length > textWords.length)
        return false;
    let i = 0;
    for (const word of textWords) {
        if (word[0] === term[i])
            i++;
        if (i === term.length)
            return true;
    }
    return false;
}

/**
 * How close the typed `query` is to `text` (a name, its keywords): each typed word matched to the closest word of it,
 * the edits added up; lower is closer. Null if any typed word has no close word in it.
 */
export function fuzzyScore(query, text) {
    const terms = words(query);
    const textWords = words(text);
    if (!terms.length || !textWords.length)
        return null;
    let total = 0;
    for (const term of terms) {
        let best = null;
        for (const word of textWords) {
            const score = termToWord(term, word);
            if (score !== null && (best === null || score < best))
                best = score;
            if (best === 0)
                break;
        }
        if (best === null) {
            if (!initials(term, textWords))
                return null;
            best = 1;
        }
        total += best;
    }
    return total;
}

/** The query made looser for a search that only finds whole words or their starts (the file index, which with more
 * than one word often finds nothing at all): each word (up to three, longest first), cut to its first three letters,
 * where a misspelling is least likely, to be searched for one at a time. What they find is then ranked against the
 * whole query (`fuzzyScore`). */
export function loosen(query) {
    const cut = [...new Set(words(query).sort((a, b) => b.length - a.length)
        .map(word => word.length > 3 ? word.slice(0, 3) : word))];
    return cut.filter(word => word.length >= 2).slice(0, 3);
}

/** Like `fuzzyScore`, a name held closer than keywords: `name` matched as it is, the rest (`more`: keywords, a
 * description) one step further, so a page named like the query comes before one only mentioning it. */
export function fuzzyNameScore(query, name, more = '') {
    const byName = fuzzyScore(query, name);
    const byAll = fuzzyScore(query, `${name} ${more}`);
    if (byName === null && byAll === null)
        return null;
    return Math.min(byName ?? Infinity, byAll === null ? Infinity : byAll + 1);
}
