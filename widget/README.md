# Universal widget

The widget is a dependency-free Web Component. It works with plain HTML and with frameworks that support custom elements.

Copy `now-playing-widget.js` into your site's public assets, then load it as an ES module:

```html
<script type="module" src="/now-playing-widget.js"></script>

<now-playing-widget
  endpoint="/api/now-playing"
  owner-name="Alif"
  refresh-seconds="10"
></now-playing-widget>
```

Customize it with CSS variables:

```css
now-playing-widget {
  --now-playing-background: #0f1013;
  --now-playing-foreground: #ffffff;
  --now-playing-muted: #a7a9b2;
  --now-playing-accent: #ff375f;
  --now-playing-radius: 24px;
  --now-playing-width: 440px;
}
```

Optional attributes are `playing-label`, `paused-label`, `stopped-label`, and `idle-label`. Track values are inserted with `textContent`; they are never interpreted as HTML.
