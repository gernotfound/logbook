# Dead Ends Log

| Iteration | Approach Tried | Why It Failed | Files Touched |
|---|---|---|---|
| M2 - Iter 1 | Errant `setDateTextInput` inside `handleEndCalendarDateChange` | Overwrote start date text input whenever user picked an end date from calendar picker | `src/components/Training/planning/CycleEditor.tsx:171` |
