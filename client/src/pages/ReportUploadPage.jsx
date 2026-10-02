import React, { useState, useEffect } from 'react';
import { Upload, FileText, Download, CheckCircle, AlertCircle, Loader2, Image, File } from 'lucide-react';
import API from '../services/api';

export const ReportUploadPage = () => {
  const [patientHealthId, setPatientHealthId] = useState('HID-2026-00001');
  const [reports, setReports] = useState([]);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Lab Report');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchReports();
  }, [patientHealthId]);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await API.get(`/reports/patient/${patientHealthId}`);
      setReports(res.data?.data || []);
    } catch (err) {
      console.warn('Fetch reports fallback:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check size limit: 10 MB = 10,485,760 bytes
    if (file.size > 10 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'File size exceeds 10 MB limit. Please select a smaller file.' });
      setSelectedFile(null);
      return;
    }

    const type = file.type.toLowerCase();
    const valid = type.includes('pdf') || type.includes('jpeg') || type.includes('jpg') || type.includes('png');
    if (!valid) {
      setMessage({ type: 'error', text: 'Invalid file type. Only PDF, JPG, and PNG files are allowed.' });
      setSelectedFile(null);
      return;
    }

    setMessage(null);
    setSelectedFile(file);
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile || !title) return;

    setUploading(true);
    setMessage(null);

    try {
      // Step 1: Request signed upload URL from server
      const urlRes = await API.post('/reports/upload-url', {
        fileName: selectedFile.name,
        fileType: selectedFile.type,
        fileSize: selectedFile.size,
        patientHealthId
      });

      const { reportId, storagePath, uploadUrl } = urlRes.data?.data || {};

      // Step 2: Save metadata to backend
      const saveRes = await API.post('/reports', {
        id: reportId,
        patientHealthId,
        title,
        category,
        storagePath,
        fileType: selectedFile.type,
        fileSize: selectedFile.size
      });

      setMessage({ type: 'success', text: `Diagnostic report "${title}" uploaded successfully!` });
      setTitle('');
      setSelectedFile(null);
      fetchReports();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Error uploading report.' });
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (reportId) => {
    try {
      const res = await API.get(`/reports/${reportId}/download-url`);
      const downloadUrl = res.data?.data?.downloadUrl;
      if (downloadUrl) {
        window.open(downloadUrl, '_blank');
      }
    } catch (err) {
      alert('Error fetching download link: ' + err.message);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center space-x-3 pb-4 border-b border-slate-200">
        <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
          <Upload className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Diagnostic Reports Upload & Vault</h1>
          <p className="text-xs text-slate-500">Secure signed upload (PDF, PNG, JPG up to 10 MB limit)</p>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-2xl text-xs font-semibold flex items-center space-x-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Upload Form */}
      <form onSubmit={handleUploadSubmit} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4">
        <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Upload New Diagnostic Document</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Document Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="E.g. Blood Test Report, Chest X-Ray..."
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
            >
              <option value="Lab Report">Lab Report</option>
              <option value="Imaging / X-Ray">Imaging / X-Ray</option>
              <option value="ECG / Cardiology">ECG / Cardiology</option>
              <option value="Discharge Summary">Discharge Summary</option>
            </select>
          </div>
        </div>

        {/* File Picker */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
            File Attachment * (PDF, JPG, PNG — Max 10 MB)
          </label>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileChange}
            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
          />
          {selectedFile && (
            <p className="text-[11px] text-emerald-700 font-medium mt-1">
              Selected: {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={uploading || !selectedFile || !title}
          className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center space-x-2"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          <span>{uploading ? 'Generating Signed URL & Uploading...' : 'Upload Diagnostic Report'}</span>
        </button>
      </form>

      {/* Reports List */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xl space-y-4">
        <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Uploaded Diagnostic Reports</h2>

        {loading ? (
          <div className="py-8 text-center">
            <Loader2 className="w-6 h-6 text-brand-600 animate-spin mx-auto" />
          </div>
        ) : reports.length === 0 ? (
          <p className="text-xs text-slate-500 py-6 text-center">No uploaded diagnostic reports found.</p>
        ) : (
          <div className="divide-y divide-slate-100 border rounded-2xl overflow-hidden">
            {reports.map((r) => (
              <div key={r.id} className="p-4 bg-slate-50/50 hover:bg-slate-50 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {r.fileType?.includes('pdf') ? (
                    <File className="w-6 h-6 text-rose-500" />
                  ) : (
                    <Image className="w-6 h-6 text-brand-500" />
                  )}
                  <div>
                    <h3 className="text-xs font-bold text-slate-800">{r.title}</h3>
                    <p className="text-[11px] text-slate-500">
                      Category: {r.category} | Uploaded by: {r.uploadedByRole}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => handleDownload(r.id)}
                  className="px-3 py-1.5 bg-white border hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl flex items-center space-x-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Signed File</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportUploadPage;
