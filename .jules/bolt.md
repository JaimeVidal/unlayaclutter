## 2024-03-24 - O(N^2) Array Allocation Bug Fixed

**Learning:** Found a serious N^2 performance bug where `[...next].some(...)` was inside `[...next].filter(...)`, meaning a new array was spread repeatedly in nested iterations, significantly slowing down DOM cleanup.
**Action:** Lift array spreading outside nested `.filter` and `.some` calls whenever using `[...Set]` to avoid O(N²) array allocations.
