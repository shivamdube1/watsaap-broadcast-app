# Conventions

## JavaScript Standards
- **ES Modules**: Use `import`/`export` across all files. No `require` (except for specific node internals if needed).
- **Asynchronous Flow**: Strict use of `async`/`await` for all Promise-generating operations (DB, IO, WA).
- **Direct Variable Injection**: Use `${}` template literals for strings.

## Naming Conventions
- **Files**: `camelCase.js` for modules (e.g., `mongoAuthState.js`).
- **Variables/Functions**: `camelCase`.
- **Database Models**: `PascalCase` (e.g., `Contact`).
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `MONGODB_URI`).

## Error Handling
- **Graceful Failure**: Always wrap socket closing or DB writes in `try/catch`. 
- **User Feedback**: Propagate errors to the UI via Socket.io `status` events or API JSON responses.
- **Silent Logger**: Use `pino` with level `silent` for protocol internals, but `console.log` for app-level state changes.

## Persistence
- **Upsert Patterns**: Use `findOneAndUpdate` with `upsert: true` to avoid duplicate records and handle sync updates atomically.
- **Serialization**: Use `BufferJSON` when saving authentication state to preserve buffers across JSON boundaries.
