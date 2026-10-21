# Shuttle Command Markup Language (SCML) and Interpreter

## Interpreter

```shell
bun run scml --continue
bun run scml --file ./msg
bun run scml -f ./msg -c
```

Set `SHUTTLE_CLIENT_HOST` to connect to a Shuttle. If it is absent, the CLI
starts a server on `SHUTTLE_SERVER_PORT` and waits for a Shuttle connection.
`SHUTTLE_CLIENT_PORT` and `SHUTTLE_SERVER_PORT` default to `1337`.

`--file` also accepts `-f`. The file is compiled before networking starts. With
`-c`/`--continue`, it is replayed whenever a Shuttle connects and the console
stays open. Without `-c`/`--continue`, the file is a one-shot program: after
its last instruction finishes, the CLI waits five seconds and exits without
opening the console. A file is required in this one-shot mode.

Console lines are compiled and queued in the same order. Use `:help`, `:quit`,
or `:exit` for local console commands.

### Syntax Overview

Plain UTF-8 text is sent as-is. Tags are case-insensitive and use comma
separated arguments. `\<`, `\>`, and `\\` produce a literal bracket or
backslash in plain text.

Supported raw and device tags include:

```text
<0xNN> <ESC> <ETX> <ACK> <LF> <CR>
<BEEP> <CLEAR> <SLEEP> <WAKE> <RESET>
<BL:ON|OFF|1|0> <SCAN:ON|OFF|1|0>
<FONT:NORM|NORMAL|LARGE>
<POS:x,y> <PX:x,y> <GIF:id>
<ALIGN:mode>text</ALIGN>
```

`ALIGN` accepts the full `StringAlignment` enum names and the aliases from the
protocol (`LT`, `CT`, `RT`, `LC`, `CC`, `RC`, `LB`, `CB`, `RB`, `LCY`, `CCY`,
`RCY`, `TCX`, `CCX`, `BCX`). Its text is measured in UTF-8 bytes, must be at
most 75 bytes, and receives an automatic `0x03` terminator when shorter than
75 bytes.

### Execution Delay

`<SLEEP>` keeps its protocol meaning and sends the Shuttle sleep command
(`1B 40`). To pause the CLI before continuing with the next instruction, use
`<SLEEP:milliseconds>`:

```text
<CLEAR>Hello<SLEEP:500><BEEP>
```

The delay is local to the CLI and sends no bytes. It accepts an integer from
`0` through `2147483647` milliseconds. Parsing errors are reported before the
program is sent, including `ERR_UNCLOSED_TAG`, `ERR_UNKNOWN_CMD`,
`ERR_ARG_COUNT`, `ERR_OUT_OF_RANGE`, and `ERR_ALIGN_OVERFLOW`.

---

## Shuttle Command Markup Language (SCML)

### 1. Basic Syntax and Escaping

The input string is processed from left to right as a stream of plain UTF-8 text and control tags.

- **Plain text:** Any characters outside of control brackets are converted directly into `UTF-8` encoded bytes.
- **Control tag:** Enclosed in angle brackets (e.g., `<BEEP>`). Case inside the tag **does not matter** (`<beep>`, `<Beep>`, and `<BEEP>` are equivalent).
- **Tag parameters:** Separated from the command name by a colon `:`, and from each other by a comma `,` (e.g., `<POS:5,2>`). Spaces around parameters are ignored.
- **Escaping:** A backslash `\` before an opening/closing bracket or another backslash cancels its special meaning:
  - `\<` becomes a plain text character `<` (byte `0x3C`).
  - `\>` becomes a plain text character `>` (byte `0x3E`).
  - `\\` becomes a single character `\` (byte `0x5C`).

### 2. Tag Types and Command Table

#### 2.1. Raw Bytes and Basic ASCII Characters (Level 1)

Used for low-level debugging and testing undocumented features according to the manufacturer's manual.

| Tag Syntax | Description | Result in Bytes (HEX) |
| --- | --- | --- |
| `<0xNN>` | Arbitrary byte in HEX (from `00` to `FF`) | `NN` (e.g., `<0x1B>` -> `1B`) |
| `<ESC>` | Escape — start of a command sequence | `1B` |
| `<ETX>` | End of Text — string terminator | `03` |
| `<ACK>` | Acknowledge — confirmation | `06` |
| `<LF>` | Line Feed — newline | `0A` |
| `<CR>` | Carriage Return | `0D` |

#### 2.2. Atomic Device Commands (Level 2)

Parameterless commands and toggle commands that map directly to methods of the `Shuttle` class.

|  Tag Syntax                       |  Result in Bytes (HEX)  |
|-----------------------------------|-------------------------|
|  `<BEEP>`                         |  `1B 5E`                |
|  `<CLEAR>`                        |  `1B 24`                |
|  `<SLEEP>`                        |  `1B 40`                |
|  `<WAKE>`                         |  `1B 41`                |
|  `<RESET>`                        |  `1B 5A`                |
|  `<BL:ON>` / `<BL:1>`             |  `1B 5C 31`             |
|  `<BL:OFF>` / `<BL:0>`            |  `1B 5C 30`             |
|  `<SCAN:ON>` / `<SCAN:1>`         |  `1B 5B 31`             |
|  `<SCAN:OFF>` / `<SCAN:0>`        |  `1B 5B 30`             |
|  `<FONT:NORM>` / `<FONT:NORMAL>`  |  `1B 42 30`             |
|  `<FONT:LARGE>`                   |  `1B 42 31`             |

#### 2.3. Parameterized Commands (Level 3)

Commands requiring range validation and automatic calculation of the `+ 0x30` offset.

| Tag Syntax | Parameters and Constraints | Byte Formula (HEX) |
| --- | --- | --- |
| `<POS:x,y>` | `x` in `[0..15]`, `y` in `[0..4]` | `1B 27 (x + 0x30) (y + 0x30)` |
| `<PX:x,y>` | `x` in `[0..127]`, `y` in `[0..63]` | `1B 2C (x + 0x30) (y + 0x30)` |
| `<GIF:id>` | `id` in `[1..4]` | `1B 58 (id + 0x30)` |

### 3. Smart Alignment Container `<ALIGN:...>`

In the protocol, the `sendPrintAlignedString` command has strict limitations: the text length in UTF-8 must not exceed **75 bytes**, and if it is strictly less than 75 bytes, a `0x03` (`<ETX>`) terminator must be appended to the end.

To avoid counting multi-byte characters (such as Cyrillic) and placing `<ETX>` manually, the specification provides a **block mode**:

- **Syntax:** `<ALIGN:mode>Text</ALIGN>`
- **Compiler behavior:**
  1. Takes all UTF-8 text between `<ALIGN:...>` and `</ALIGN>`.
  2. Verifies that its length in bytes does not exceed `75` (otherwise, throws a compilation error before sending to the socket).
  3. Prepends the prefix `1B 2E <alignment_code>`, followed by the text bytes, and automatically appends `03` at the end if the text length is less than 75 bytes.

**Alignment Mode Codes (both full Enum names and short aliases are supported):**

| Full Name | Short Alias | Byte (HEX) | Full Name | Short Alias | Byte (HEX) |
| --- | --- | --- | --- | --- | --- |
| `LEFT_TOP` | `LT` | `30` | `RIGHT_BOTTOM` | `RB` | `38` |
| `CENTER_TOP` | `CT` | `31` | `LEFT_WITH_CURRENT_Y` | `LCY` | `39` |
| `RIGHT_TOP` | `RT` | `32` | `CENTER_WITH_CURRENT_Y` | `CCY` | `3A` |
| `LEFT_CENTER` | `LC` | `33` | `RIGHT_WITH_CURRENT_Y` | `RCY` | `3B` |
| `CENTER_CENTER` | `CC` | `34` | `TOP_WITH_CURRENT_X` | `TCX` | `3C` |
| `RIGHT_CENTER` | `RC` | `35` | `CENTER_WITH_CURRENT_X` | `CCX` | `3D` |
| `LEFT_BOTTOM` | `LB` | `36` | `BOTTOM_WITH_CURRENT_X` | `BCX` | `3E` |
| `CENTER_BOTTOM` | `CB` | `37` | | | |

---

### 4. Formal Grammar (EBNF)

This grammar can be used to write a parser or validator:

```ebnf
Program        ::= Element*
Element        ::= EscapedChar | AlignBlock | CommandTag | PlainText

EscapedChar    ::= "\" ("<" | ">" | "\")
AlignBlock     ::= "<ALIGN:" AlignmentMode ">" PlainText "</ALIGN>"
CommandTag     ::= "<" TagName (":" ArgList)? ">"

TagName        ::= HexByte | Identifier
HexByte        ::= "0x" [0-9A-Fa-f]{2}
Identifier     ::= [A-Za-z_]+
ArgList        ::= Arg ("," Arg)*
Arg            ::= [A-Za-z0-9_]+
PlainText      ::= ([^<\] | EscapedChar)+
```

---

### 5. Validation Rules and Error Codes

The parser must validate the string **before** sending the first bytes to the TCP socket (atomicity principle: either the entire packet is valid, or nothing is sent to the device).

1. **`ERR_UNCLOSED_TAG`**: An opening bracket `<` was found, but no closing `>` was found before the end of the string (unless `<` is escaped as `\<`).
2. **`ERR_UNKNOWN_CMD`**: The tag name was not found in the specification table.
3. **`ERR_ARG_COUNT`**: An invalid number of arguments was passed (e.g., `<POS:5>` instead of `<POS:5,0>`).
4. **`ERR_OUT_OF_RANGE`**: A numeric parameter is out of the device specification bounds (e.g., `<GIF:9>` or `<POS:20,10>`).
5. **`ERR_ALIGN_OVERFLOW`**: The length of the UTF-8 string inside the `<ALIGN:...>` block exceeds 75 bytes (especially relevant for Cyrillic, where 1 character takes 2 bytes).

---

### 6. Valid String Examples According to Specification

- **Simple product card:**
```text
<CLEAR><FONT:NORM><POS:0,0>Кофе зерновой 1кг<FONT:LARGE><ALIGN:CB>1 499 ₽</ALIGN><BEEP>
```

- **Outputting text with brackets (escaping):**
```text
<CLEAR><ALIGN:CC>Скидка \<50%\>!</ALIGN>
```

- **Hybrid mode (high-level tag + raw bytes from the manual):**
```text
<CLEAR><0x1B><0x2E><0x34>Ручной ETX<ETX>
```