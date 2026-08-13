# A2UI Review Form

Emit a `declarative` artifact containing this JSON when the user asks for a
structured review form:

```json
{
  "version": "neuma/a2ui-v0.9-subset",
  "root": {
    "type": "Card",
    "children": [
      { "type": "Heading", "text": "Review request" },
      {
        "type": "Form",
        "children": [
          {
            "type": "TextField",
            "props": {
              "label": "Summary",
              "name": "summary"
            }
          },
          {
            "type": "Select",
            "props": {
              "label": "Priority",
              "name": "priority",
              "options": ["low", "normal", "high"]
            }
          },
          {
            "type": "Button",
            "text": "Submit",
            "props": {
              "action": "submit-review"
            }
          }
        ]
      }
    ]
  },
  "actions": [
    {
      "id": "submit-review",
      "label": "Submit",
      "variant": "primary"
    }
  ]
}
```
