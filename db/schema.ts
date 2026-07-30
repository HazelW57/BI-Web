import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authUsers = sqliteTable("auth_users", {
  email: text("email").primaryKey(), passwordHash: text("password_hash").notNull(), salt: text("salt").notNull(),
  role: text("role").notNull(), hidden: integer("hidden").notNull().default(0),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
});
