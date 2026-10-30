// DriveEasy database tables go here (Drizzle ORM). Run `pnpm db:generate` after changing them.
// The btree_gist extension is installed in both databases, so exclusion constraints such as
// "no overlapping rentals for the same car" can combine `car_id WITH =` and `period WITH &&`.
export {};
