#!/usr/bin/env bun

import { grammarDB } from "./grammardb-sqlite";

async function main() {
  console.log("🏗️  Building GrammarDB SQLite database...");
  console.log("📂 Source: ./data/grammardb/");
  console.log("💾 Target: ./data/grammardb.sqlite");
  console.log("");
  
  const startTime = Date.now();
  
  try {
    await grammarDB.initialize();
    await grammarDB.importFromXML();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Database built successfully in ${elapsed}s`);
    
    // Show some stats
    const db = new (await import("bun:sqlite")).Database("./data/grammardb.sqlite");
    const stats = db.query(`
      SELECT 
        (SELECT COUNT(*) FROM stress_entries) as total_lemmas,
        (SELECT COUNT(*) FROM stress_entries WHERE is_technical = 1) as technical_words,
        (SELECT COUNT(*) FROM word_forms) as total_forms
    `).get() as any;
    
    console.log("\n📊 Database Statistics:");
    console.log(`   Total lemmas: ${stats.total_lemmas.toLocaleString()}`);
    console.log(`   Technical words: ${stats.technical_words.toLocaleString()}`);
    console.log(`   Total word forms: ${stats.total_forms.toLocaleString()}`);
    
    db.close();
  } catch (error) {
    console.error("❌ Error building database:", error);
    process.exit(1);
  } finally {
    grammarDB.close();
  }
}

main();