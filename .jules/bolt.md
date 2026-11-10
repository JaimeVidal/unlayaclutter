## 2024-05-15 - DOM Traversal Optimization

**Learning:** `el.querySelectorAll("p")` coupled with array spread operations (`[...el.querySelectorAll("p")].some(...)`) is significantly slower than `el.getElementsByTagName("p")` with a standard `for` loop because `querySelectorAll` returns a static snapshot, whereas `getElementsByTagName` returns a live HTMLCollection which is faster to fetch, and the array spread creates unnecessary memory allocations.

**Action:** Replace `querySelectorAll` and array spreading with `getElementsByTagName` and a standard `for` loop when checking properties of multiple elements for performance critical code paths.
