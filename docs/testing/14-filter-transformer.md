# 14 — Filter/Transformer UI

## Prerequisites
- Logged in as admin
- At least one channel created

## Source Filter Section

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Accordion expands | Click Source Filter accordion in Source tab | Section expands to show filter rules | |
| 2 | Accordion collapses | Click expanded Source Filter accordion | Section collapses | |
| 3 | Add filter rule | Click Add Rule button | New rule row appears with defaults | |
| 4 | Rule type — JavaScript | Select JAVASCRIPT from type dropdown | Monaco editor appears for script | |
| 5 | Rule type — Rule Builder | Select RULE_BUILDER from type dropdown | Field/condition/values inputs appear | |
| 6 | Rule Builder fields | Select RULE_BUILDER type | Field, condition dropdown, and values inputs visible | |
| 7 | Remove rule | Click remove/delete button on a rule | Rule removed from list | |
| 8 | Reorder rules | Click up/down arrows on a rule | Rule moves position in list | |
| 9 | Enabled toggle | Toggle enabled switch on a rule | Switch state changes | |

## Source Transformer Section

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 10 | Accordion expands | Click Source Transformer accordion | Section expands to show transformer steps | |
| 11 | Inbound data type | Change inbound data type dropdown | Dropdown updates | |
| 12 | Outbound data type | Change outbound data type dropdown | Dropdown updates | |
| 13 | Add transformer step | Click Add Step button | New step row appears with defaults | |
| 14 | Step type — JavaScript | Select JAVASCRIPT from type dropdown | Monaco editor appears for script | |
| 15 | Step type — Mapper | Select MAPPER from type dropdown | Source field and target field inputs appear | |
| 16 | Step type — Message Builder | Select MESSAGE_BUILDER from type dropdown | Monaco editor appears | |
| 17 | Remove step | Click remove/delete button on a step | Step removed from list | |
| 18 | Reorder steps | Click up/down arrows on a step | Step moves position in list | |
| 19 | Enabled toggle | Toggle enabled switch on a step | Switch state changes | |

## Destination Filter Section

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 20 | Destination filter accordion | Open Destinations tab → select destination → expand filter | Filter section visible within destination panel | |
| 21 | Add destination filter rule | Click Add Rule in destination filter section | New rule appears with defaults | |
| 22 | Independent from source | Add rules to destination filter | Destination filter rules are independent of source filter | |

## Destination Transformer Section

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 23 | Destination transformer accordion | Open Destinations tab → select destination → expand transformer | Transformer section visible within destination panel | |
| 24 | Add destination transformer step | Click Add Step in destination transformer | New step appears with defaults | |
| 25 | Independent from source | Add steps to destination transformer | Destination steps are independent of source transformer | |

## Persistence

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 26 | Source filter persists | Add source filter rule → save channel → reload → open Source tab | Rule still present | |
| 27 | Source transformer persists | Add source transformer step → save → reload | Step still present | |
| 28 | Destination filter persists | Add destination filter rule → save → reload → select destination | Rule still present | |
| 29 | Destination transformer persists | Add destination transformer step → save → reload → select dest | Step still present | |
