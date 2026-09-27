// The five tables Azm 5.0 created inline at startup, verbatim. IF NOT EXISTS keeps an existing
// database (and its rows) untouched; a fresh database gets exactly the same schema text.
export const version = 1;
export const name = "baseline";
export const sql = `
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),intake TEXT NOT NULL,plan TEXT NOT NULL,version INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS workouts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),plan TEXT NOT NULL,version INTEGER NOT NULL,demo INTEGER NOT NULL,position INTEGER DEFAULT 0,ended INTEGER DEFAULT 0,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),workout_id TEXT NOT NULL,position INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(workout_id,position));`;
