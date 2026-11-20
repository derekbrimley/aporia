-- "View as tester": an admin's sign-in session as another user. Set only on those sessions; the app
-- treats them as read-only and shows a banner with a way back to the admin's own account.
ALTER TABLE "auth_sessions" ADD COLUMN "impersonator_user_id" uuid;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_impersonator_user_id_users_id_fk" FOREIGN KEY ("impersonator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
