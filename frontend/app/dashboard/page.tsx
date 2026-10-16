'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, AlertCircle, Award, Clock } from 'lucide-react';

interface ProgressData {
  configured: boolean;
  student: {
    user_id: string;
    name: string;
    level: string;
    topics_covered: string[];
    weak_spots: string[];
    last_interaction: string | null;
  };
  calls: Array<{
    id: string;
    started_at: string;
    duration_s: number;
    outcome: string;
    concepts_taught: number;
    problems_given: number;
  }>;
}

export default function StudentDashboardPage() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [name, setName] = useState('user');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/student/${encodeURIComponent(name)}/progress`)
      .then((res) => res.json())
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [name]);

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#2B3A55] p-6 md:p-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold text-[#8C8177] hover:text-[#C4704F] transition"
          >
            <ArrowLeft size={18} /> Back to Classroom
          </Link>
          <span className="font-mono text-xs uppercase px-3 py-1 rounded-full bg-[#EFE9DF] text-[#8C8177]">
            {data?.configured ? 'Neon Serverless Connected' : 'Local Preview'}
          </span>
        </div>

        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-[#1E293B]">
            Student Learning Dashboard
          </h1>
          <p className="text-base text-[#64748B] mt-1">
            Tracking your whiteboard lessons, mastered concepts, and ongoing review topics.
          </p>
        </header>

        {loading ? (
          <div className="py-20 text-center text-sm font-medium text-[#8C8177]">
            Loading your learning records...
          </div>
        ) : (
          <div className="space-y-6">
            {/* Top overview stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-[#E8DFD2] shadow-sm">
                <div className="flex items-center gap-3 text-[#C4704F] mb-2">
                  <BookOpen size={20} />
                  <span className="font-semibold text-sm">Topics Covered</span>
                </div>
                <div className="text-3xl font-extrabold text-[#1E293B]">
                  {data?.student.topics_covered.length ?? 0}
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E8DFD2] shadow-sm">
                <div className="flex items-center gap-3 text-amber-600 mb-2">
                  <AlertCircle size={20} />
                  <span className="font-semibold text-sm">Focus Areas</span>
                </div>
                <div className="text-3xl font-extrabold text-[#1E293B]">
                  {data?.student.weak_spots.length ?? 0}
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E8DFD2] shadow-sm">
                <div className="flex items-center gap-3 text-emerald-600 mb-2">
                  <Award size={20} />
                  <span className="font-semibold text-sm">Proficiency Level</span>
                </div>
                <div className="text-2xl font-bold capitalize text-[#1E293B]">
                  {data?.student.level || 'Beginner'}
                </div>
              </div>
            </div>

            {/* Topics breakdown */}
            <div className="p-6 rounded-2xl bg-white border border-[#E8DFD2] shadow-sm">
              <h2 className="text-lg font-bold mb-4">Concepts You Explored</h2>
              {data?.student.topics_covered.length ? (
                <div className="flex flex-wrap gap-2">
                  {data.student.topics_covered.map((t, idx) => (
                    <span
                      key={idx}
                      className="px-3.5 py-1.5 rounded-xl text-sm font-medium bg-[#F4EFEB] text-[#4A4038] border border-[#E2D8CC]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#8C8177]">
                  No lessons recorded yet. Start a class with Acharya to build your board history!
                </p>
              )}
            </div>

            {/* Call History */}
            <div className="p-6 rounded-2xl bg-white border border-[#E8DFD2] shadow-sm">
              <h2 className="text-lg font-bold mb-4">Recent Sessions</h2>
              {data?.calls.length ? (
                <div className="divide-y divide-[#F0ECE1]">
                  {data.calls.map((c) => (
                    <div key={c.id} className="py-3.5 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3">
                        <Clock size={16} className="text-[#8C8177]" />
                        <span className="font-medium text-[#1E293B]">
                          {new Date(c.started_at).toLocaleDateString()}
                        </span>
                        <span className="text-xs text-[#8C8177]">
                          ({Math.round(c.duration_s / 60)} mins)
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                          {c.concepts_taught} concept{c.concepts_taught === 1 ? '' : 's'}
                        </span>
                        <span className="text-xs font-semibold uppercase tracking-wider text-[#8C8177]">
                          {c.outcome}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#8C8177]">
                  No call analytics found. Completed lessons will display their duration and topics here.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
