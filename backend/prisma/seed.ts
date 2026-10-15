import 'dotenv/config';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();

const strongPassword = z
  .string()
  .min(12, 'must be at least 12 characters')
  .refine((value) => !value.toUpperCase().includes('REPLACE'), 'replace the placeholder with your own password');

const seedEnv = z
  .object({
    SEED_SUPER_ADMIN_EMAIL: z.string().email(),
    SEED_SUPER_ADMIN_PASSWORD: strongPassword,
    SEED_SAMPLE_DATA: z.enum(['true', 'false']).default('false'),
    SEED_SAMPLE_PASSWORD: strongPassword.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.SEED_SAMPLE_DATA === 'true' && !value.SEED_SAMPLE_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SEED_SAMPLE_PASSWORD'],
        message: 'is required when SEED_SAMPLE_DATA=true',
      });
    }
  });

async function seedSuperAdmin(email: string, password: string) {
  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {}, // never overwrite an existing admin's password on re-seed
    create: {
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      firstName: 'System',
      lastName: 'Administrator',
      role: Role.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`Super admin ready: ${user.email}`);
}

async function seedSampleData(password: string) {
  const passwordHash = await hashPassword(password);
  const verified = { status: UserStatus.ACTIVE, emailVerifiedAt: new Date() };

  const institution = await prisma.institution.upsert({
    where: { slug: 'demo-institute' },
    update: {},
    create: { name: 'Demo Institute', slug: 'demo-institute', contactEmail: 'office@demo.example' },
  });

  const makeUser = (email: string, firstName: string, lastName: string, role: Role, studentNumber?: string) =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        firstName,
        lastName,
        role,
        studentNumber,
        institutionId: institution.id,
        ...verified,
      },
    });

  await makeUser('admin@demo.example', 'Demo', 'Admin', Role.INSTITUTION_ADMIN);
  const instructor = await makeUser('instructor@demo.example', 'Demo', 'Instructor', Role.INSTRUCTOR);
  const students = await Promise.all([
    makeUser('student1@demo.example', 'Student', 'One', Role.STUDENT, 'S-0001'),
    makeUser('student2@demo.example', 'Student', 'Two', Role.STUDENT, 'S-0002'),
    makeUser('student3@demo.example', 'Student', 'Three', Role.STUDENT, 'S-0003'),
  ]);

  const course = await prisma.course.upsert({
    where: { institutionId_code: { institutionId: institution.id, code: 'CS101' } },
    update: {},
    create: {
      institutionId: institution.id,
      code: 'CS101',
      name: 'Introduction to Computer Science',
    },
  });

  await prisma.courseInstructor.upsert({
    where: { courseId_userId: { courseId: course.id, userId: instructor.id } },
    update: {},
    create: { courseId: course.id, userId: instructor.id },
  });

  const group = await prisma.group.upsert({
    where: { institutionId_name: { institutionId: institution.id, name: 'CS101 - Class A' } },
    update: {},
    create: {
      institutionId: institution.id,
      courseId: course.id,
      name: 'CS101 - Class A',
      academicYear: '2026',
    },
  });

  for (const student of students) {
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: student.id } },
      update: {},
      create: { groupId: group.id, userId: student.id },
    });
  }

  console.log('Sample data ready: Demo Institute, 1 admin, 1 instructor, 3 students, 1 course, 1 group');
}

async function main() {
  const parsed = seedEnv.safeParse(process.env);
  if (!parsed.success) {
    console.error('Seed configuration problem:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  const config = parsed.data;

  if (process.env.NODE_ENV === 'production' && config.SEED_SAMPLE_DATA === 'true') {
    console.error('Refusing to seed sample data in production.');
    process.exit(1);
  }

  await seedSuperAdmin(config.SEED_SUPER_ADMIN_EMAIL, config.SEED_SUPER_ADMIN_PASSWORD);
  if (config.SEED_SAMPLE_DATA === 'true' && config.SEED_SAMPLE_PASSWORD) {
    await seedSampleData(config.SEED_SAMPLE_PASSWORD);
  }
}

main()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());