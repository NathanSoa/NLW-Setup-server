import { FastifyInstance } from "fastify"
import { prisma } from "./prisma"
import { z } from "zod"
import dayjs from 'dayjs'

export async function appRoutes(app: FastifyInstance) {

    app.post("/habits", async (request) => {

        const createHabitBody = z.object({
            title: z.string(),
            weekDays: z.array(z.number().min(0).max(6))
        })

        const { title, weekDays } = createHabitBody.parse(request.body)

        const today = dayjs().startOf('day').toDate()

        await prisma.habit.create({
            data: {
                title,
                created_at: today,
                weekDays: {
                    create: weekDays.map(weekDay => {
                        return {
                            week_day: weekDay
                        }
                    })
                }
            }
        })
    })

    app.get("/days", async (request) => {
        const getDayParams = z.object({
            date: z.coerce.date()
        })

        const { date } = getDayParams.parse(request.query)

        const parsedDate = dayjs(date).startOf('day')
        const weekDay = parsedDate.get('day')

        const possibleHabits = await prisma.habit.findMany({
            where: {
                created_at: {
                    lte: date
                },
                weekDays: {
                    some: {
                        week_day: weekDay
                    }
                }
            }
        })

        const day = await prisma.day.findUnique({
            where: {
                date: parsedDate.toDate()
            },
            include: {
                dayHabits: true
            }
        })

        const completedHabits = day?.dayHabits.map(dayHabit => dayHabit.habit_id) ?? []

        return {
            possibleHabits,
            completedHabits
        }
    })

    /*
        This route will only create a new day record only if user complete any habit 
        It's not possible to complete any habit in previous days
    */
    app.patch("/habits/:id/toggle", async (request) => {
        const toggleHabitParams = z.object({
            id: z.string().uuid()
        })

        const { id } = toggleHabitParams.parse(request.params)
        const today = dayjs().startOf('day').toDate()

        let day = await prisma.day.findUnique({
            where: {
                date: today
            }
        })

        // If there's no day record, it will create a new one
        if(!day) {
            day = await prisma.day.create({
                data: {
                    date: today
                }
            })
        }

        // Find the habit relation 
        const dayHabit = await prisma.dayHabit.findUnique({
            where: {
                day_id_habit_id: {
                    day_id: day.id,
                    habit_id: id
                }
            }
        })

        if(dayHabit) {
            await prisma.dayHabit.delete({
                where: {
                    day_id_habit_id: {
                        day_id: day.id,
                        habit_id: id
                    }
                }
            })
        } else {
            // Complete the habit 
            await prisma.dayHabit.create({
                data: {
                    day_id: day.id,
                    habit_id: id
                }
            })

        }
    })

    /*

    */
    app.get("/summary", async () => {
        const summary = await prisma.$queryRaw`
            SELECT d.id, d.date,
                (
                    SELECT cast(count(*) as float)
                    FROM days_habits dh
                    WHERE dh.day_id = d.id
                ) as completed,
                (
                    SELECT cast(count(*) as float)
                    FROM habit_week_days hwd
                    JOIN habits h
                        ON h.id = hwd.habit_id
                    WHERE 
                        hwd.week_day = cast(strftime('%w', d.date / 1000.0, 'unixepoch') as int)
                        AND h.created_at <= d.date
                ) as amount
            FROM Days d
        `

        return summary
    })
}
