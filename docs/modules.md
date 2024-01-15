[@clickup/pg-mig](README.md) / Exports

# @clickup/pg-mig

## Functions

### main

▸ **main**(): `Promise`\<`boolean`\>

CLI tool entry point. This function is run when `pg-mig` is called from the
command line. Accepts parameters from process.argv. See `migrate()` for
option names.

If no options are passed, uses `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
`PGDATABASE` environment variables which are standard for e.g. `psql`.

You can pass multiple hosts separated by comma or semicolon.

Examples:
```
pg-mig --make=my-migration-name@sh
pg-mig --make=other-migration-name@sh0000
pg-mig --undo 20191107201239.my-migration-name.sh
pg-mig
```

#### Returns

`Promise`\<`boolean`\>

#### Defined in

[src/cli.ts:39](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L39)

___

### migrate

▸ **migrate**(`options`): `Promise`\<`boolean`\>

Similar to main(), but accepts options explicitly, not from process.argv.
This function is meant to be called from other tools.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | `Object` | - |
| `options.migDir` | `string` | The directory the migration versions are loaded from. |
| `options.hosts` | `string`[] | List of PostgreSQL master hostnames. The migration versions in `migDir` will be applied to all of them. |
| `options.port` | `number` | PostgreSQL port on each hosts. |
| `options.user` | `string` | PostgreSQL user on each host. |
| `options.pass` | `string` | PostgreSQL password on each host. |
| `options.db` | `string` | PostgreSQL database name on each host. |
| `options.parallelism?` | `number` | How many schemas to process in parallel (defaults to 10). |
| `options.undo?` | `string` | If passed, switches the action to undo the provided migration version. |
| `options.make?` | `string` | If passed, switches the action to create a new migration version. |
| `options.dry?` | `boolean` | If true, prints what it plans to do, but doesn't change anything. |
| `options.list?` | `boolean` | Lists all versions in `migDir`. |
| `options.ci?` | `boolean` | If true, then doesn't use logUpdate() and doesn't replace lines; instead, prints logs to stdout line by line. |

#### Returns

`Promise`\<`boolean`\>

#### Defined in

[src/cli.ts:79](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L79)
