export function parseTargets(input) {
    if (!Array.isArray(input))
        throw Error('請提供網址清單');
    const unique = new Set();
    input.forEach((line, index) => {
        if (typeof line === 'string' && !line.trim())
            return;
        try {
            if (typeof line !== 'string')
                throw Error();
            const target = new URL(line.trim());
            if (!['https:', 'http:'].includes(target.protocol))
                throw Error();
            unique.add(target.href);
        }
        catch {
            throw Error(`第 ${index + 1} 行請輸入完整的 HTTP／HTTPS 網址`);
        }
    });
    if (!unique.size)
        throw Error('請輸入至少一個網址');
    if (unique.size > 50)
        throw Error('每批最多可擷取 50 個網址');
    return [...unique];
}
