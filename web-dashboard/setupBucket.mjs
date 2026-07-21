import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function ensurePublicBucket(bucketName) {
  const { data: buckets, error: getError } = await supabaseAdmin.storage.listBuckets();

  if (getError) {
    console.error("Error fetching buckets:", getError);
    throw getError;
  }

  const bucketExists = buckets.some((b) => b.name === bucketName);

  if (!bucketExists) {
    console.log(`Bucket not found. Creating '${bucketName}' bucket...`);

    // Create public bucket
    const { error: createError } = await supabaseAdmin.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: 5242880, // 5MB
    });

    if (createError) {
      console.error(`Failed to create '${bucketName}' bucket:`, createError);
      throw createError;
    }
    console.log(`✅ '${bucketName}' created successfully!`);
  } else {
    console.log(`✅ '${bucketName}' already exists. Making sure it is public...`);
    await supabaseAdmin.storage.updateBucket(bucketName, {
      public: true,
    });
  }
}

async function setupBuckets() {
  await ensurePublicBucket("student-photos");
  await ensurePublicBucket("uniform-references");
  console.log("✅ Required storage buckets are ready.");
}

setupBuckets();
