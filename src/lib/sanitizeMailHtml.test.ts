// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM": {"settings": {"disableJavaScriptEvaluation": true, "disableJavaScriptFileLoading": true, "disableCSSFileLoading": true, "disableIframePageLoading": true}}}
//
// XSS fixture tests for the render-time mail HTML sanitizer (M2/M7).
// The sanitizer needs a real DOM (DOMParser), so this file runs under
// happy-dom while the rest of the suite stays on the node environment.
// JS evaluation is disabled so hostile fixtures can never execute inside
// the test DOM itself.
import { describe, expect, it } from 'vitest'
import { mailHtmlHasRemoteImages, sanitizeMailHtml } from './sanitizeMailHtml'

describe('sanitizeMailHtml XSS fixtures', () => {
  it('removes <script> elements and their content', () => {
    const clean = sanitizeMailHtml(
      '<p>hi</p><script>document.title="pwned"</script>',
    )
    expect(clean).toContain('<p>hi</p>')
    expect(clean).not.toContain('script')
    expect(clean).not.toContain('pwned')
  })

  it('strips img onerror handlers', () => {
    const clean = sanitizeMailHtml(
      '<img src="data:image/png;base64,AAAA" onerror="alert(1)">',
    )
    expect(clean).not.toContain('onerror')
    expect(clean).not.toContain('alert')
  })

  it('strips event-handler attributes regardless of case (oNcLiCk)', () => {
    const clean = sanitizeMailHtml('<div oNcLiCk="alert(1)" ONLOAD="x()">a</div>')
    expect(clean.toLowerCase()).not.toContain('onclick')
    expect(clean.toLowerCase()).not.toContain('onload')
    expect(clean).toContain('a')
  })

  it('removes javascript: hrefs', () => {
    const clean = sanitizeMailHtml('<a href="javascript:alert(1)">click</a>')
    expect(clean).not.toContain('javascript:')
    expect(clean).toContain('click')
  })

  it('removes obfuscated javascript: hrefs', () => {
    const clean = sanitizeMailHtml(
      '<a href="jAvAsCrIpT:alert(1)">a</a><a href="java\tscript:alert(1)">b</a>',
    )
    expect(clean.toLowerCase()).not.toContain('script:alert')
  })

  it('removes data:text/html sources', () => {
    const clean = sanitizeMailHtml(
      '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>' +
        '<img src="data:text/html,<script>alert(1)</script>">',
    )
    expect(clean).not.toContain('iframe')
    expect(clean).not.toContain('data:text/html')
  })

  it('strips nested <svg onload> payloads', () => {
    const clean = sanitizeMailHtml(
      '<div><svg onload="alert(1)"><g onload="alert(2)"></g></svg></div>',
    )
    expect(clean.toLowerCase()).not.toContain('onload')
    expect(clean).not.toContain('alert')
  })

  it('strips style attributes, including expression() payloads', () => {
    const clean = sanitizeMailHtml(
      '<div style="width:expression(alert(1));position:fixed">x</div>',
    )
    expect(clean).not.toContain('style=')
    expect(clean).not.toContain('expression')
    expect(clean).toContain('x')
  })

  it('keeps the styling the sender wrote, minus anything out-of-flow', () => {
    const clean = sanitizeMailHtml(
      '<p style="font-weight: bold; text-align: center; position: fixed; color: red; z-index: 9">x</p>',
    )
    expect(clean).toContain('font-weight: bold')
    expect(clean).toContain('text-align: center')
    expect(clean).toContain('color: red')
    expect(clean).not.toContain('position')
    expect(clean).not.toContain('z-index')
  })

  it('rejects hostile values on allowlisted style properties', () => {
    const clean = sanitizeMailHtml(
      '<p style="font-weight: expression(alert(1)); text-align: url(x)">x</p>',
    )
    expect(clean).not.toContain('style=')
  })

  it('keeps underline and strike so emphasis reads as written', () => {
    const clean = sanitizeMailHtml(
      '<span style="text-decoration: underline">a</span><span style="text-decoration-line: line-through">b</span>',
    )
    expect(clean).toContain('text-decoration: underline')
    expect(clean).toContain('text-decoration-line: line-through')
  })

  it('keeps <style> only filtered, renamed, and scoped — it cannot restyle the app', () => {
    // The sender's sheet survives (hybrid newsletters need it), but every
    // selector is prefixed with the message scope class AND every class
    // name is renamed into the pm-c- namespace, so a rule written against
    // an app class can never match an app node.
    const clean = sanitizeMailHtml(
      '<style>.app{display:none}</style><p class="app">body</p>',
    )
    expect(clean).toMatch(
      /<style>\.pm-msg-\d+ \.pm-c-app \{ display: none; \}<\/style>/,
    )
    expect(clean).not.toContain('.app{')
    expect(clean).not.toContain('class="app"')
    expect(clean).toContain('<p class="pm-c-app">body</p>')
  })

  it('removes iframe/object/embed/form/input and <base>', () => {
    const clean = sanitizeMailHtml(
      '<base href="https://evil.example/">' +
        // about:blank keeps happy-dom from attempting a real frame fetch;
        // the assertion is about element removal, not the URL.
        '<iframe src="about:blank"></iframe>' +
        '<object data="https://evil.example"></object>' +
        '<embed src="https://evil.example">' +
        '<form action="https://evil.example"><input name="password"></form>' +
        '<p>keep me</p>',
    )
    expect(clean).not.toMatch(/<(base|iframe|object|embed|form|input)\b/i)
    expect(clean).toContain('<p>keep me</p>')
  })

  it('forces target=_blank and rel=noopener noreferrer on links', () => {
    const clean = sanitizeMailHtml(
      '<a href="https://example.com" target="_top">site</a>',
    )
    expect(clean).toContain('target="_blank"')
    expect(clean).toContain('rel="noopener noreferrer"')
    expect(clean).toContain('href="https://example.com"')
  })

  it('keeps benign formatting and table markup intact', () => {
    const source =
      '<h2>Order confirmed</h2>' +
      '<p><strong>Thanks</strong>, <em>User</em> — see <u>details</u> below.</p>' +
      '<table><thead><tr><th colspan="2">Item</th></tr></thead>' +
      '<tbody><tr><td>Widget</td><td>2</td></tr></tbody></table>' +
      '<ul><li>One</li><li>Two</li></ul>' +
      '<blockquote>Quoted reply</blockquote>' +
      '<pre><code>inline code</code></pre>' +
      '<hr><br><span title="note">note</span>' +
      '<a href="mailto:mira@example.com">mail Mira</a>'
    const clean = sanitizeMailHtml(source, { allowRemoteImages: true })
    for (const fragment of [
      '<h2>Order confirmed</h2>',
      '<strong>Thanks</strong>',
      '<em>User</em>',
      '<u>details</u>',
      '<th colspan="2">Item</th>',
      '<td>Widget</td>',
      '<li>One</li>',
      '<blockquote>Quoted reply</blockquote>',
      '<code>inline code</code>',
      '<hr>',
      '<br>',
      'title="note"',
      'href="mailto:mira@example.com"',
    ]) {
      expect(clean).toContain(fragment)
    }
  })

  it('keeps embedded data:image and cid: images', () => {
    const clean = sanitizeMailHtml(
      '<img src="data:image/png;base64,AAAA" alt="logo">' +
        '<img src="cid:part1.abc@example.com" alt="inline">',
      { allowRemoteImages: true },
    )
    expect(clean).toContain('data:image/png;base64,AAAA')
    expect(clean).toContain('cid:part1.abc@example.com')
  })

  it('blocks remote images by default and restores them on opt-in', () => {
    const source = '<p>text</p><img src="https://tracker.example/pixel.png">'
    const blocked = sanitizeMailHtml(source)
    // A bare src= attribute must be gone (data-puremail-blocked-src remains).
    expect(blocked).not.toMatch(/\ssrc="https:\/\/tracker\.example/)
    expect(blocked).toContain(
      'data-puremail-blocked-src="https://tracker.example/pixel.png"',
    )
    expect(mailHtmlHasRemoteImages(source)).toBe(true)

    const allowed = sanitizeMailHtml(source, { allowRemoteImages: true })
    expect(allowed).toContain('src="https://tracker.example/pixel.png"')
  })

  it('reports no remote images for embedded-only mail', () => {
    expect(
      mailHtmlHasRemoteImages('<img src="data:image/png;base64,AAAA">'),
    ).toBe(false)
  })

  it('removes object/embed and their payloads', () => {
    const clean = sanitizeMailHtml(
      '<p>ok</p><object data="https://evil.example/x.swf">fallback</object>' +
        '<embed src="https://evil.example/x.swf">',
    )
    expect(clean).toContain('<p>ok</p>')
    expect(clean).not.toContain('object')
    expect(clean).not.toContain('embed')
    expect(clean).not.toContain('evil.example')
  })

  it('strips javascript: URLs from href and src', () => {
    const clean = sanitizeMailHtml(
      '<a href="javascript:alert(1)">x</a>' +
        '<a href="JaVaScRiPt:alert(2)">y</a>' +
        '<img src="javascript:alert(3)">',
    )
    expect(clean.toLowerCase()).not.toContain('javascript:')
  })

  it('blocks non-image data: URLs but keeps data:image sources', () => {
    const clean = sanitizeMailHtml(
      '<a href="data:text/html,<script>alert(1)</script>">x</a>' +
        '<img src="data:image/png;base64,AAAA">',
      { allowRemoteImages: true },
    )
    expect(clean).not.toContain('data:text/html')
    expect(clean).toContain('data:image/png;base64,AAAA')
  })

  it('drops inline style so CSS expressions and overlays cannot run', () => {
    const clean = sanitizeMailHtml(
      '<div style="width: expression(alert(1)); position: fixed">x</div>',
    )
    expect(clean).not.toContain('style=')
    expect(clean).not.toContain('expression')
  })

  it('removes iframes including srcdoc payloads', () => {
    const clean = sanitizeMailHtml(
      '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe><p>hi</p>',
    )
    expect(clean).not.toContain('iframe')
    expect(clean).not.toContain('srcdoc')
    expect(clean).toContain('<p>hi</p>')
  })

  it('removes svg (and its event handlers) with content', () => {
    const clean = sanitizeMailHtml(
      '<svg onload="alert(1)"><circle r="1"/></svg><p>after</p>',
    )
    expect(clean).not.toContain('svg')
    expect(clean).not.toContain('onload')
    expect(clean).toContain('<p>after</p>')
  })

  it('neutralizes composer-paste payloads the same way as the reader', () => {
    // The composer routes clipboard HTML through this exact function; a
    // hostile paste must come out inert.
    const hostilePaste =
      '<meta http-equiv="refresh" content="0;url=https://evil.example">' +
      '<form action="https://evil.example"><input name="pw" type="password"></form>' +
      '<b onmouseover="alert(1)">bold</b>'
    const clean = sanitizeMailHtml(hostilePaste, { allowRemoteImages: true })
    expect(clean).not.toContain('meta')
    expect(clean).not.toContain('form')
    expect(clean).not.toContain('input')
    expect(clean).not.toContain('onmouseover')
    expect(clean).toContain('bold')
  })
})

describe('spacer-block collapse', () => {
  it('drops p/div blocks that hold only <br> or whitespace', () => {
    const html =
      '<p>Hi User,</p><p><br></p><div>&nbsp;</div><p>Sorry to hear.</p><div><br/><br/></div><p>Taylor.</p>'
    const clean = sanitizeMailHtml(html)
    expect(clean).toBe('<p>Hi User,</p><p>Sorry to hear.</p><p>Taylor.</p>')
  })

  it('keeps blocks that carry images, rules, or links', () => {
    const html =
      '<p><img src="data:image/png;base64,AAA"></p><div><hr></div><p><a href="https://x.example"> </a></p>'
    const clean = sanitizeMailHtml(html)
    expect(clean).toContain('<img')
    expect(clean).toContain('<hr')
    expect(clean).toContain('<a')
  })

  it('keeps empty blocks that SET their spacing — MJML designed spacers', () => {
    // The hair-space spacer MJML emits between newsletter cards. Collapsing
    // it crushed the O'Reilly digest by ~760px versus Gmail.
    const clean = sanitizeMailHtml(
      '<div style="height:20px;line-height:20px"> </div>' +
        '<div style="padding:0 0 10px 0">&nbsp;</div>' +
        '<p style="margin-top:24px"><br></p>',
    )
    expect(clean).toContain('height: 20px; line-height: 20px')
    expect(clean).toContain('padding: 0 0 10px 0')
    expect(clean).toContain('margin-top: 24px')
  })

  it('still collapses empty blocks whose spacing styles are all zero', () => {
    const clean = sanitizeMailHtml(
      '<p>a</p>' +
        '<div style="height:0;line-height:normal;margin:0 auto">&nbsp;</div>' +
        '<p style="margin:0"> </p>' +
        '<p>b</p>',
    )
    expect(clean).toBe('<p>a</p><p>b</p>')
  })
})

describe('image layout stability', () => {
  it('keeps numeric width/height so the browser reserves space', () => {
    const html = sanitizeMailHtml(
      '<img src="https://example.com/a.png" width="600" height="400" alt="chart">',
      { allowRemoteImages: true },
    )
    expect(html).toContain('width="600"')
    expect(html).toContain('height="400"')
  })

  it('drops dimensions that carry no aspect ratio', () => {
    for (const pair of [
      'width="100%" height="auto"',
      'width="600px" height="400px"',
      'width="junk" height="400"',
    ]) {
      const html = sanitizeMailHtml(
        `<img src="https://example.com/a.png" ${pair}>`,
        { allowRemoteImages: true },
      )
      expect(html).not.toMatch(/width=|height=/)
    }
  })

  it('drops a lone dimension rather than squashing the image', () => {
    const html = sanitizeMailHtml(
      '<img src="https://example.com/a.png" width="600">',
      { allowRemoteImages: true },
    )
    expect(html).not.toMatch(/width=|height=/)
  })

  it('still strips scripting attributes from images', () => {
    const html = sanitizeMailHtml(
      '<img src="https://example.com/a.png" width="600" height="400" onload="alert(1)" onerror="alert(2)">',
      { allowRemoteImages: true },
    )
    expect(html).not.toContain('onload')
    expect(html).not.toContain('onerror')
  })
})

/**
 * The layout language real notification mail is written in: nested tables,
 * an avatar cell beside a name cell, spacer cells that exist only for their
 * width, and buttons built as padded cells holding a link each. This is the
 * shape of the Google-Docs-notification rendering bug: strip these and the
 * avatar jams into the name, the spacers collapse, and the two buttons fuse
 * into "ReplyOpen".
 */
describe('table-layout fidelity (Google-Docs-style notification)', () => {
  const fixture =
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" align="center" bgcolor="#f5f5f5"><tbody><tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border: 1px solid #dadce0; border-radius: 8px"><tbody>' +
    '<tr>' +
    '<td width="40" valign="top" style="padding: 16px 8px 16px 16px">' +
    '<img src="cid:avatar@docs.example" width="32" height="32" alt="Mira Chen">' +
    '</td>' +
    '<td valign="middle" style="padding: 16px 16px 16px 0; font-family: Roboto, Arial, sans-serif; font-size: 14px; color: #3c4043">' +
    '<strong>Mira Chen</strong> mentioned you in ' +
    '<a href="https://docs.example.com/document/d/abc">Q3 planning</a>' +
    '</td>' +
    '</tr>' +
    '<tr><td colspan="2" height="8"></td></tr>' +
    '<tr><td colspan="2" style="padding: 0 16px 16px">' +
    '<table cellpadding="0" cellspacing="0"><tbody><tr>' +
    '<td align="center" bgcolor="#1a73e8" style="padding: 8px 16px; border-radius: 4px">' +
    '<a href="https://docs.example.com/document/d/abc/edit" style="color: #ffffff; font-weight: bold">Reply</a>' +
    '</td>' +
    '<td width="12"></td>' +
    '<td align="center" style="padding: 8px 16px; border: 1px solid #dadce0; border-radius: 4px">' +
    '<a href="https://docs.example.com/document/d/abc">Open</a>' +
    '</td>' +
    '</tr></tbody></table>' +
    '</td></tr>' +
    '</tbody></table>' +
    '</td></tr></tbody></table>'

  it('keeps the table layout attributes the sender designed', () => {
    const clean = sanitizeMailHtml(fixture, { allowRemoteImages: true })
    for (const fragment of [
      'width="100%"',
      'cellpadding="0"',
      'cellspacing="0"',
      'border="0"',
      'align="center"',
      'bgcolor="#f5f5f5"',
      'width="600"',
      'width="40"', // the avatar cell keeps its width
      'valign="top"',
      'valign="middle"',
      'height="8"', // the spacer row keeps its height
      'width="12"', // the gap cell between the two buttons survives
      'bgcolor="#1a73e8"',
      'colspan="2"',
    ]) {
      expect(clean).toContain(fragment)
    }
  })

  it('keeps the inline styles that give the mail its rhythm', () => {
    const clean = sanitizeMailHtml(fixture, { allowRemoteImages: true })
    for (const fragment of [
      'background-color: #ffffff',
      'border: 1px solid #dadce0',
      'border-radius: 8px',
      'padding: 16px 8px 16px 16px',
      'padding: 16px 16px 16px 0',
      'font-family: roboto,arial,sans-serif',
      'font-size: 14px',
      'color: #3c4043',
      'padding: 8px 16px',
      'color: #ffffff',
      'font-weight: bold',
    ]) {
      expect(clean).toContain(fragment)
    }
  })

  it('keeps the two button links in separate padded cells (no "ReplyOpen")', () => {
    const clean = sanitizeMailHtml(fixture, { allowRemoteImages: true })
    const doc = new DOMParser().parseFromString(clean, 'text/html')
    const reply = [...doc.querySelectorAll('a')].find(
      a => a.textContent === 'Reply',
    )
    const open = [...doc.querySelectorAll('a')].find(
      a => a.textContent === 'Open',
    )
    expect(reply).toBeTruthy()
    expect(open).toBeTruthy()
    const replyCell = reply!.closest('td')
    const openCell = open!.closest('td')
    expect(replyCell).toBeTruthy()
    expect(openCell).toBeTruthy()
    expect(replyCell).not.toBe(openCell)
    expect(replyCell!.getAttribute('style')).toContain('padding: 8px 16px')
    expect(openCell!.getAttribute('style')).toContain('padding: 8px 16px')
    // A spacer cell with an explicit width sits between the two buttons.
    const spacer = replyCell!.nextElementSibling
    expect(spacer?.tagName.toLowerCase()).toBe('td')
    expect(spacer?.getAttribute('width')).toBe('12')
  })

  it('keeps the avatar image and the name in their own cells', () => {
    const clean = sanitizeMailHtml(fixture, { allowRemoteImages: true })
    const doc = new DOMParser().parseFromString(clean, 'text/html')
    const avatar = doc.querySelector('img[alt="Mira Chen"]')
    expect(avatar).toBeTruthy()
    expect(avatar!.getAttribute('width')).toBe('32')
    const avatarCell = avatar!.closest('td')
    expect(avatarCell!.getAttribute('width')).toBe('40')
    const nameCell = avatarCell!.nextElementSibling
    expect(nameCell?.textContent).toContain('Mira Chen mentioned you')
    expect(nameCell?.getAttribute('style')).toContain('padding: 16px 16px 16px 0')
  })
})

describe('the widened allowlist stays closed', () => {
  it('drops invalid table attribute values rather than passing them through', () => {
    const clean = sanitizeMailHtml(
      '<table width="600;position:fixed" align="evil" cellpadding="9999" bgcolor="url(https://evil.example)"><tbody><tr>' +
        '<td valign="hover" height="10px">x</td>' +
        '</tr></tbody></table>',
    )
    expect(clean).not.toContain('width=')
    expect(clean).not.toContain('align=')
    expect(clean).not.toContain('cellpadding=')
    expect(clean).not.toContain('bgcolor=')
    expect(clean).not.toContain('valign=')
    expect(clean).toContain('height="10px"')
  })

  it('keeps the newsletter flow properties: inline-table, overflow, direction, word-spacing', () => {
    const clean = sanitizeMailHtml(
      '<table style="display:inline-table"><tbody><tr><td>a</td></tr></tbody></table>' +
        '<div style="overflow:hidden;max-height:0">preheader</div>' +
        '<div style="direction:ltr;word-spacing:normal">b</div>' +
        '<span style="word-spacing:-1px">c</span>',
    )
    expect(clean).toContain('display: inline-table')
    expect(clean).toContain('overflow: hidden')
    expect(clean).toContain('direction: ltr')
    expect(clean).toContain('word-spacing: normal')
    expect(clean).toContain('word-spacing: -1px')
  })

  it('keeps the new grammars closed: junk overflow/direction/word-spacing values drop', () => {
    const clean = sanitizeMailHtml(
      '<div style="overflow:clip">a</div>' +
        '<div style="direction:sideways">b</div>' +
        '<div style="word-spacing:100vw">c</div>' +
        '<div style="display:flex">d</div>',
    )
    expect(clean).not.toContain('overflow')
    expect(clean).not.toContain('direction')
    expect(clean).not.toContain('word-spacing')
    expect(clean).not.toContain('display')
  })

  it('drops bgcolor values that are not colors (javascript:, expressions)', () => {
    const clean = sanitizeMailHtml(
      '<table><tbody><tr>' +
        '<td bgcolor="javascript:alert(1)">a</td>' +
        '<td bgcolor="expression(alert(1))">b</td>' +
        '<td bgcolor="#1a73e8">c</td>' +
        '</tr></tbody></table>',
    )
    expect(clean).not.toContain('javascript')
    expect(clean).not.toContain('expression')
    expect(clean).toContain('bgcolor="#1a73e8"')
  })

  it('rejects url() on every style property — styling can never phone home', () => {
    const clean = sanitizeMailHtml(
      '<div style="background-image: url(https://evil.example/x.png)">a</div>' +
        '<div style="padding: url(https://evil.example)">b</div>' +
        '<div style="width: url(https://evil.example)">c</div>',
    )
    expect(clean).not.toContain('style=')
    expect(clean).not.toContain('url(')
    expect(clean).not.toContain('evil.example')
  })

  it('keeps the background shorthand ONLY when the whole value is a color', () => {
    // Senders write `background:#fff` constantly; that is pure color and
    // survives. Any other shorthand payload can carry url() — the value
    // fails the closed color grammar and the declaration is dropped whole.
    const clean = sanitizeMailHtml(
      '<table><tbody><tr>' +
        '<td style="background: #ffffff">a</td>' +
        '<td style="background: #fff url(https://evil.example/x.png)">b</td>' +
        '<td style="background: #fff no-repeat center">c</td>' +
        '<td style="background-color: #ffffff">d</td>' +
        '</tr></tbody></table>',
    )
    expect(clean).toContain('<td style="background: #ffffff">a</td>')
    expect(clean).toContain('<td>b</td>')
    expect(clean).toContain('<td>c</td>')
    expect(clean).not.toContain('url(')
    expect(clean).toContain('background-color: #ffffff')
  })

  it('drops negative margins (overlay vector) but keeps non-negative ones', () => {
    const clean = sanitizeMailHtml(
      '<div style="margin-top: -20px">a</div>' +
        '<div style="margin: -10px 0">b</div>' +
        '<div style="margin: 0 auto">c</div>' +
        '<div style="margin-top: 12px">d</div>',
    )
    expect(clean).not.toContain('-20px')
    expect(clean).not.toContain('-10px')
    expect(clean).toContain('margin: 0 auto')
    expect(clean).toContain('margin-top: 12px')
  })

  it('clamps font-size: type survives, viewport-filling letters do not', () => {
    const clean = sanitizeMailHtml(
      '<span style="font-size: 400px">huge</span>' +
        '<span style="font-size: 96pt">big</span>' +
        '<span style="font-size: 14px">normal</span>' +
        '<span style="font-size: 72pt">poster</span>',
    )
    expect(clean).not.toContain('400px')
    expect(clean).not.toContain('96pt')
    expect(clean).toContain('font-size: 14px')
    expect(clean).toContain('font-size: 72pt')
  })

  it('keeps position/inset/z-index/transform/opacity/visibility banned', () => {
    const clean = sanitizeMailHtml(
      '<div style="position: fixed; top: 0; left: 0; z-index: 9999; transform: scale(10); opacity: 0; visibility: hidden; pointer-events: none">x</div>',
    )
    expect(clean).not.toContain('style=')
  })

  it('rejects var()/attr()/image-set() and CSS escapes on allowlisted properties', () => {
    const clean = sanitizeMailHtml(
      '<div style="color: var(--evil)">a</div>' +
        '<div style="padding: attr(data-x)">b</div>' +
        '<div style="background-color: image-set(url(https://evil.example))">c</div>' +
        '<div style="width: \\75 rl(https://evil.example)">d</div>',
    )
    expect(clean).not.toContain('style=')
  })

  it('keeps the remote-image gate working over styled table mail', () => {
    const source =
      '<table width="600" cellpadding="8" bgcolor="#ffffff"><tbody><tr>' +
      '<td style="padding: 8px"><img src="https://tracker.example/pixel.png" width="1" height="1"></td>' +
      '</tr></tbody></table>'
    const blocked = sanitizeMailHtml(source)
    expect(blocked).not.toMatch(/\ssrc="https:\/\/tracker\.example/)
    expect(blocked).toContain('data-puremail-blocked-src=')
    // Layout survives blocking: the gate touches only the image source.
    expect(blocked).toContain('cellpadding="8"')
    expect(blocked).toContain('padding: 8px')
    expect(mailHtmlHasRemoteImages(source)).toBe(true)
  })
})

/**
 * Round 2: mobile-first hybrid newsletters. Real ESP mail stacks its
 * columns by default (inline-block divs at width:100%) and un-stacks them
 * with !important rules inside a min-width media query in <head><style>.
 * Dropping the style block renders the phone fallback in a desktop pane —
 * this is exactly what the O'Reilly events digest looked like. The sheet
 * must survive filtered (shared per-property allowlist), scoped (per-
 * message container class), and renamed (pm-c-/pm-i- namespaces).
 */
describe('embedded <style> blocks: filtered, scoped, renamed', () => {
  const hybrid =
    '<html><head><style type="text/css">' +
    '@import url("https://fonts.example/evil.css");' +
    '@font-face { font-family: "Evil"; src: url("https://evil.example/f.woff2"); }' +
    'body { margin: 0; background-color: #f4f4f4; }' +
    '.card { border: 1px solid #dddddd; border-radius: 8px; }' +
    '.digest-btn a:hover { background-color: #a33f1f; }' +
    '@media only screen and (min-width: 481px) {' +
    '  .stack { display: inline-block !important; vertical-align: top !important; }' +
    '  .col-avatars { width: 170px !important; }' +
    '  .col-copy { width: 370px !important; }' +
    '}' +
    '@media print { .card { display: none; } }' +
    '</style></head><body><center>' +
    '<div class="card" style="background: #ffffff; padding: 24px 20px">' +
    '<div class="stack col-avatars" style="display: inline-block; width: 100%">avatars</div>' +
    '<div class="stack col-copy" style="display: inline-block; width: 100%">copy</div>' +
    '</div></center></body></html>'

  const scopeOf = (clean: string): string => {
    const match = /class="(pm-msg-\d+)"/.exec(clean)
    expect(match).toBeTruthy()
    return match![1]!
  }

  it('keeps the desktop media query, filtered, with !important intact', () => {
    const clean = sanitizeMailHtml(hybrid, { allowRemoteImages: true })
    const scope = scopeOf(clean)
    expect(clean).toContain('@media only screen and (min-width:481px)')
    expect(clean).toContain(
      `.${scope} .pm-c-stack { display: inline-block !important; vertical-align: top !important; }`,
    )
    expect(clean).toContain(
      `.${scope} .pm-c-col-avatars { width: 170px !important; }`,
    )
    expect(clean).toContain(
      `.${scope} .pm-c-col-copy { width: 370px !important; }`,
    )
  })

  it('scopes every surviving selector under the per-message class', () => {
    const clean = sanitizeMailHtml(hybrid, { allowRemoteImages: true })
    const scope = scopeOf(clean)
    const styleText = /<style>([\s\S]*?)<\/style>/.exec(clean)![1]!
    for (const line of styleText.split('\n')) {
      if (line.startsWith('@media') || line === '}') continue
      expect(line.trimStart()).toMatch(new RegExp(`^\\.${scope} `))
    }
    // The markup carries the matching renamed classes inside the wrapper.
    expect(clean).toContain(`<div class="${scope}"><style>`)
    expect(clean).toContain('class="pm-c-stack pm-c-col-avatars"')
  })

  it('drops @import and @font-face entirely — CSS can never fetch', () => {
    const clean = sanitizeMailHtml(hybrid, { allowRemoteImages: true })
    expect(clean).not.toContain('@import')
    expect(clean).not.toContain('@font-face')
    expect(clean).not.toContain('url(')
    expect(clean).not.toContain('evil.example')
    expect(clean).not.toContain('fonts.example')
  })

  it('drops @keyframes and @supports blocks whole', () => {
    const clean = sanitizeMailHtml(
      '<style>' +
        '@keyframes spin { from { width: 0 } to { width: 100px } }' +
        '@supports (display: grid) { .card { color: red } }' +
        '.keep { color: red }' +
        '</style><p class="keep">x</p>',
    )
    expect(clean).not.toContain('@keyframes')
    expect(clean).not.toContain('@supports')
    expect(clean).not.toContain('spin')
    expect(clean).toMatch(/\.pm-msg-\d+ \.pm-c-keep \{ color: red; \}/)
  })

  it('drops selectors that touch html, body, or :root', () => {
    const clean = sanitizeMailHtml(hybrid, { allowRemoteImages: true })
    expect(clean).not.toMatch(/body \{/)
    const other = sanitizeMailHtml(
      '<style>html { display: none } :root { color: red } body div { color: red } .ok { color: blue }</style><div class="ok">x</div>',
    )
    expect(other).not.toContain('html')
    expect(other).not.toContain(':root')
    expect(other).not.toMatch(/body/)
    expect(other).toMatch(/\.pm-msg-\d+ \.pm-c-ok \{ color: blue; \}/)
  })

  it('keeps the selector grammar closed: no pseudo, attribute, or * selectors', () => {
    const clean = sanitizeMailHtml(
      '<style>' +
        'a:hover { color: red }' +
        'a::before { content: "x" }' +
        'div[onclick] { color: red }' +
        '* { margin: 0 }' +
        'div + p { color: red }' +
        'div ~ p { color: red }' +
        'iframe { display: block }' +
        'td.cell { color: green }' +
        'table > tbody td { color: purple }' +
        '</style><table><tbody><tr><td class="cell">x</td></tr></tbody></table>',
    )
    expect(clean).not.toContain(':hover')
    expect(clean).not.toContain('::before')
    expect(clean).not.toContain('[onclick]')
    expect(clean).not.toMatch(/\* \{/)
    expect(clean).not.toContain('+')
    expect(clean).not.toContain('~')
    expect(clean).not.toContain('iframe')
    expect(clean).toMatch(/\.pm-msg-\d+ td\.pm-c-cell \{ color: green; \}/)
    expect(clean).toMatch(
      /\.pm-msg-\d+ table > tbody td \{ color: purple; \}/,
    )
  })

  it('runs style-rule declarations through the shared per-property filter', () => {
    const clean = sanitizeMailHtml(
      '<style>.x { position: fixed; z-index: 9; color: red; background-image: url(https://evil.example/x.png) }</style>' +
        '<p class="x">x</p>',
    )
    expect(clean).not.toContain('position')
    expect(clean).not.toContain('z-index')
    expect(clean).not.toContain('url(')
    expect(clean).toMatch(/\.pm-msg-\d+ \.pm-c-x \{ color: red; \}/)
  })

  it('keeps only screen/width-type media conditions', () => {
    const clean = sanitizeMailHtml(hybrid, { allowRemoteImages: true })
    expect(clean).not.toContain('print')
    const other = sanitizeMailHtml(
      '<style>' +
        '@media (orientation: landscape) { .a { color: red } }' +
        '@media screen and (hover: hover) { .a { color: red } }' +
        '@media screen and (max-width: 596px) { .a { color: blue } }' +
        '@media (max-device-width: 480px) { .a { color: green } }' +
        '</style><p class="a">x</p>',
    )
    expect(other).not.toContain('orientation')
    expect(other).not.toContain('hover')
    expect(other).toContain('@media screen and (max-width:596px)')
    expect(other).toContain('@media (max-device-width:480px)')
  })

  it('validates and renames class tokens; hostile class values drop', () => {
    const clean = sanitizeMailHtml(
      '<p class="col-copy">a</p>' +
        '<p class="ok &quot;)</style> bad">b</p>' +
        '<p class="{}">c</p>',
    )
    // No CSS survives here, so no wrapper — but classes are still renamed.
    expect(clean).toContain('<p class="pm-c-col-copy">a</p>')
    expect(clean).toContain('<p class="pm-c-ok pm-c-bad">b</p>')
    expect(clean).toContain('<p>c</p>')
    expect(clean).not.toContain('{')
  })

  it('renames id attributes and #id selectors into the same namespace', () => {
    const clean = sanitizeMailHtml(
      '<style>#hero { color: red } #evil() { color: blue }</style>' +
        '<div id="hero">x</div><div id="not a token">y</div>',
    )
    expect(clean).toMatch(/\.pm-msg-\d+ #pm-i-hero \{ color: red; \}/)
    expect(clean).toContain('<div id="pm-i-hero">x</div>')
    expect(clean).toContain('<div>y</div>')
    expect(clean).not.toContain('evil')
  })

  it('adds no wrapper or <style> when nothing in the sheet survives', () => {
    const clean = sanitizeMailHtml(
      '<style>@import url(https://evil.example); body { margin: 0 }</style><p>plain</p>',
    )
    expect(clean).toBe('<p>plain</p>')
  })

  it('ignores sheets nested inside removed containers (noscript)', () => {
    const clean = sanitizeMailHtml(
      '<noscript><style>.x { color: red }</style></noscript><p class="x">x</p>',
    )
    expect(clean).not.toContain('<style>')
    expect(clean).toContain('<p class="pm-c-x">x</p>')
  })

  it('keeps the remote-image gate intact across a scoped style block', () => {
    const source =
      '<style>.x { color: red }</style>' +
      '<p class="x"><img src="https://tracker.example/pixel.png"></p>'
    const blocked = sanitizeMailHtml(source)
    expect(blocked).not.toMatch(/\ssrc="https:\/\/tracker\.example/)
    expect(blocked).toContain('data-puremail-blocked-src=')
    expect(blocked).toMatch(/\.pm-msg-\d+ \.pm-c-x \{ color: red; \}/)
    expect(mailHtmlHasRemoteImages(source)).toBe(true)
  })
})

describe('legacy presentation: <center>, <font>, dir/lang', () => {
  it('keeps <center> and its centering semantics as a real element', () => {
    const clean = sanitizeMailHtml('<center><p>middle</p></center>')
    expect(clean).toBe('<center><p>middle</p></center>')
  })

  it('keeps <font> with validated color/size/face', () => {
    const clean = sanitizeMailHtml(
      '<font color="#d3552e" size="2" face="Helvetica, Arial, sans-serif">eyebrow</font>',
    )
    expect(clean).toContain('color="#d3552e"')
    expect(clean).toContain('size="2"')
    expect(clean).toContain('face="Helvetica, Arial, sans-serif"')
    expect(clean).toContain('eyebrow')
  })

  it('drops invalid font attribute values, keeping the element', () => {
    const clean = sanitizeMailHtml(
      '<font color="javascript:alert(1)" size="900" face="evil(url)">x</font>',
    )
    expect(clean).toBe('<font>x</font>')
  })

  it('keeps dir and lang with validated values on any element', () => {
    const clean = sanitizeMailHtml(
      '<div dir="rtl" lang="he">שלום</div><p dir="upside-down" lang="not a lang">x</p>',
    )
    expect(clean).toContain('dir="rtl"')
    expect(clean).toContain('lang="he"')
    expect(clean).not.toContain('upside-down')
    expect(clean).not.toContain('not a lang')
  })
})
