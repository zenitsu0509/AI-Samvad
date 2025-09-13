'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';

interface FormData {
  name: string;
  email: string;
  domain: string;
  numQuestions: number;
  durationMinutes: number;
}

const domains = [
  { id: 'nlp', label: 'Natural Language Processing (NLP)', icon: '🗣️' },
  { id: 'cv', label: 'Computer Vision', icon: '👁️' },
  { id: 'diffusion', label: 'Diffusion Models', icon: '🎨' },
  { id: 'ml', label: 'Machine Learning', icon: '🤖' },
  { id: 'dl', label: 'Deep Learning', icon: '🧠' },
  { id: 'rl', label: 'Reinforcement Learning', icon: '🎮' },
  { id: 'data-science', label: 'Data Science', icon: '📊' },
  { id: 'web-dev', label: 'Web Development', icon: '🌐' }
];

export default function UserRegistrationForm() {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    domain: '',
    numQuestions: 3,
    durationMinutes: 15,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

      // 1) Register user
      const regRes = await fetch(`${BASE_URL}/api/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!regRes.ok) throw new Error(`Register failed: ${regRes.status}`);
      const regData = await regRes.json();
      const userId = regData.user_id as string;

      // 2) Generate questions/session
      const genRes = await fetch(
        `${BASE_URL}/api/interview/generate-questions?domain=${encodeURIComponent(formData.domain)}&user_id=${encodeURIComponent(userId)}&num_questions=${encodeURIComponent(String(formData.numQuestions))}&duration_minutes=${encodeURIComponent(String(formData.durationMinutes))}`,
        { method: 'POST' }
      );
      if (!genRes.ok) throw new Error(`Generate questions failed: ${genRes.status}`);
      const genData = await genRes.json();

      // Persist for interview page
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(`interview:${genData.session_id}`,
          JSON.stringify({
            questions: genData.questions,
            domain: genData.domain,
            total_questions: genData.total_questions,
            duration_minutes: genData.duration_minutes ?? formData.durationMinutes,
            num_questions: formData.numQuestions,
            user: { name: formData.name, email: formData.email },
          })
        );
      }

      // Redirect to interview page with session id
      window.location.href = `/interview?session_id=${encodeURIComponent(genData.session_id)}`;
    } catch (error) {
      console.error('Error submitting form:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = formData.name && formData.email && formData.domain && formData.numQuestions > 0 && formData.durationMinutes > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-gray-800/90 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-700 p-8 w-full max-w-2xl"
      >
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome to AI Interviewer 🤖
          </h1>
          <p className="text-gray-300">
            Get ready for an intelligent interview experience tailored to your domain
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Questions count and duration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="numQuestions" className="block text-sm font-medium text-gray-300 mb-2">
                Number of Questions
              </label>
              <input
                type="number"
                id="numQuestions"
                min={1}
                max={10}
                value={formData.numQuestions}
                onChange={(e) => setFormData({ ...formData, numQuestions: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors text-white placeholder-gray-400"
                placeholder="e.g., 3"
                required
              />
              <p className="text-xs text-gray-400 mt-1">Max based on available questions per domain.</p>
            </div>
            <div>
              <label htmlFor="durationMinutes" className="block text-sm font-medium text-gray-300 mb-2">
                Interview Duration (minutes)
              </label>
              <select
                id="durationMinutes"
                value={formData.durationMinutes}
                onChange={(e) => setFormData({ ...formData, durationMinutes: Number(e.target.value) })}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors text-white"
              >
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={45}>45</option>
                <option value={60}>60</option>
              </select>
            </div>
          </div>
          {/* Name Field */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
              Full Name
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors text-white placeholder-gray-400"
              placeholder="Enter your full name"
              required
            />
          </div>

          {/* Email Field */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
              Email Address
            </label>
            <input
              type="email"
              id="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors text-white placeholder-gray-400"
              placeholder="Enter your email address"
              required
            />
            <p className="text-sm text-gray-400 mt-1">
              Interview results will be sent to this email
            </p>
          </div>

          {/* Domain Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Select Interview Domain
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {domains.map((domain) => (
                <motion.label
                  key={domain.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    formData.domain === domain.id
                      ? 'border-blue-500 bg-blue-900/30 text-white'
                      : 'border-gray-600 hover:border-gray-500 bg-gray-700/50 text-gray-300 hover:text-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="domain"
                    value={domain.id}
                    checked={formData.domain === domain.id}
                    onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                    className="sr-only"
                  />
                  <span className="text-2xl mr-3">{domain.icon}</span>
                  <span className="text-sm font-medium">{domain.label}</span>
                </motion.label>
              ))}
            </div>
          </div>

          {/* Submit Button */}
          <motion.button
            type="submit"
            disabled={!isFormValid || isSubmitting}
            whileHover={{ scale: isFormValid ? 1.02 : 1 }}
            whileTap={{ scale: isFormValid ? 0.98 : 1 }}
            className={`w-full py-4 px-6 rounded-lg font-semibold text-white transition-all ${
              isFormValid && !isSubmitting
                ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer shadow-lg shadow-blue-500/25'
                : 'bg-gray-600 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                Starting Interview...
              </div>
            ) : (
              'Start AI Interview'
            )}
          </motion.button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-400">
          <p>
            The interview will include voice interaction, video recording, and anti-cheating measures.
            <br />
            Make sure you're in a quiet environment with good internet connection.
          </p>
        </div>
      </motion.div>
    </div>
  );
}