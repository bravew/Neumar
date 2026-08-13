---
name: contact-widget
description: |
  Design a compact contact, support, or lead-capture widget with clear fields,
  validation states, privacy copy, and responsive embed behavior. Use when the
  brief asks for a contact widget, support widget, inquiry form, lead form, or
  callback request.
triggers:
  - "contact widget"
  - "support widget"
  - "contact form"
  - "lead form"
  - "inquiry widget"
  - "callback request"
od:
  mode: prototype
  platform: desktop
  scenario: support
  preview:
    type: html
    entry: example.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  craft:
    requires: [state-coverage]
  outputs:
    primary: index.html
  capabilities_required:
    - file_write
  example_prompt: "Create a contact widget for a B2B SaaS site with name, work email, topic, message, validation states, and a privacy note."
---

# Contact Widget Skill

Create a compact, embeddable contact or support widget. The result should be
easy to scan, keyboard-accessible, and explicit about what happens after the
user submits.

License note: First-party Neuma-authored skill content for this repository. No
upstream proprietary text, images, templates, or third-party code were copied.

## Workflow

1. Define the task
   - Identify whether the widget is for sales, support, callback scheduling,
     community contact, or general inquiries.
   - Pick only the fields needed for that task. Do not ask for unnecessary
     personal data.

2. Required widget anatomy
   - Header: short title and response-time expectation.
   - Fields: name, email, topic, message, and optional company/phone only when
     the brief justifies them.
   - Consent/privacy note: concise, plain-language, and close to submit.
   - Submit button and secondary route such as help center, email, or status.

3. State coverage
   - Normal, focus, invalid, submitting, success, and failure states.
   - Inline validation messages tied to fields with accessible descriptions.
   - Disabled submit state when required fields are missing.

4. Layout rules
   - Widget fits in a card no wider than 440px and can embed in a sidebar,
     modal, or floating panel.
   - On mobile, full-width with stable spacing and no text clipped inside
     buttons or fields.
   - Use the active DESIGN.md tokens and component rules.

5. Self-check
   - Every input has a visible label.
   - Error copy says how to fix the issue.
   - The success state confirms the next step, not just "submitted".
   - No hidden tracking, fake urgency, or deceptive consent language.

## Output Contract

Emit a self-contained HTML artifact named `index.html` with `data-od-id` on
the widget shell, each field, submit action, and state message.
