# Example: frame-data-rollup

Native Remotion data frame: five weekday bars grow from zero while their
figures roll up to the real values and settle with the bars.

```json
{
  "title": "This week on GitHub",
  "items": [
    { "label": "Mon", "value": 1200 },
    { "label": "Tue", "value": 2400 },
    { "label": "Wed", "value": 1800 },
    { "label": "Thu", "value": 4200 },
    { "label": "Fri", "value": 3600 }
  ]
}
```

Variant with units and a custom palette:

```json
{
  "title": "Stars by month",
  "unit": "K",
  "items": [
    { "label": "Mar", "value": 12 },
    { "label": "Apr", "value": 28 },
    { "label": "May", "value": 47 }
  ],
  "accent": "#34D399",
  "background": "#0B1120"
}
```
