# Prompt Macros

Marinara supports prompt macros in preset sections, character fields, lorebook entries, slash-command prompts, and other prompt text. Type `/macros` in chat or open the macro list in the Preset Editor to see the current in-app list.

Macros use double braces:

```text
{{user}}
{{char}}
{{random::sunny::rainy::foggy}}
```

## Character Fields

Character macros resolve against the current character in single-character chats and against each character when used inside bracketed group blocks in prompt presets. Alongside fields such as `{{description}}`, `{{personality}}`, and `{{example}}`, Marinara also exposes character instruction fields:

```text
{{charSysInfo}}
{{charPostHistory}}
```

Use these when a preset needs to place a character card's system prompt or post-history instructions in a specific section.

## Random Choices

Use `{{random::A::B::C}}` to choose one option at generation time:

```text
{{random::The door creaks open.::A bell rings.::Someone laughs nearby.}}
```

Each option has the same chance by default.

Nested macros are allowed inside random choices:

```text
{{random::{{getvar::actor}} leaves.::The world ends.}}
```

## Weighted Random Choices

Add a final `@number` to an option to give it a relative weight:

```text
{{random::Common event@1::Rare event@0.25}}
```

Weights are relative. In the example above, the total weight is `1.25`:

| Option       | Weight | Chance              |
| ------------ | ------ | ------------------- |
| Common event | `1`    | `1 / 1.25 = 80%`    |
| Rare event   | `0.25` | `0.25 / 1.25 = 20%` |

This means decimals can make an option less likely:

```text
{{random::None@1::Something happens@0.5}}
```

`Something happens` is half as likely as `None`.

Whole-number weights work the same way:

```text
{{random::None@2::Something happens@1}}
```

This also makes `Something happens` half as likely as `None`.

## Weight Rules

- Missing weight means `1`.
- Decimal weights are allowed, such as `0.5` or `0.01`.
- A weight of `0` keeps the option in the macro but prevents it from being selected.
- If every option has weight `0`, the macro returns an empty string.
- Invalid weight suffixes are treated as normal text. For example, `event@rare` is just the text `event@rare`.
- Only a final top-level `@number` is treated as a weight. Other `@` symbols, such as an email address, are left alone.

Weighted choices can still contain nested macros:

```text
{{random::{{getvar::actor}} leaves.@0.5::The world ends.@0.1::A nearby car explodes.}}
```

The selected option is resolved after it is picked, so only macros in the chosen branch run.

## Literal Final `@number`

If an option really needs to end with text like `@2`, Marinara will read that as a weight. Reword the option so it does not end with a final `@number`.
