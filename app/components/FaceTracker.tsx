'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { FaceDetection } from '@mediapipe/face_detection';
import { Camera } from '@mediapipe/camera_utils';
import { FocusIcon, Play, Download, Trash2, Video, VideoOff } from "lucide-react"

interface Detection {
  boundingBox?: {
    xCenter: number;
    yCenter: number;
    width: number;
    height: number;
  };
  landmarks?: Array<{
    x: number;
    y: number;
  }>;
}

interface DetectionResult {
  detections: Detection[];
}

interface RecordedVideo {
  id: string;
  name: string;
  timestamp: number;
  duration: number;
  size: number;
  thumbnail?: string; // Base64 encoded thumbnail image
}

export default function FaceTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null); // For recording with face tracking
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [faceDetected, setFaceDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [recordedVideos, setRecordedVideos] = useState<RecordedVideo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  
  const faceDetectionRef = useRef<FaceDetection | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null); // Stream with face tracking

  // Handle face detection results
  const onResults = useCallback((results: DetectionResult) => {
    const canvas = canvasRef.current;
    const compositeCanvas = compositeCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !compositeCanvas || !video) return;

    const ctx = canvas.getContext('2d');
    const compositeCtx = compositeCanvas.getContext('2d');
    if (!ctx || !compositeCtx) return;

    // Set canvas sizes to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    compositeCanvas.width = video.videoWidth;
    compositeCanvas.height = video.videoHeight;

    // Clear overlay canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw video frame on composite canvas
    compositeCtx.drawImage(video, 0, 0, compositeCanvas.width, compositeCanvas.height);

    // Check if faces are detected
    const hasfaces = results.detections && results.detections.length > 0;
    setFaceDetected(hasfaces);

    if (hasfaces) {
      // Function to draw face tracking on a canvas context
      const drawFaceTracking = (context: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
        results.detections.forEach((detection) => {
          // Draw bounding box
          const bbox = detection.boundingBox;
          if (bbox) {
            context.strokeStyle = '#00ff00';
            context.lineWidth = 3;
            context.strokeRect(
              bbox.xCenter * canvasWidth - (bbox.width * canvasWidth) / 2,
              bbox.yCenter * canvasHeight - (bbox.height * canvasHeight) / 2,
              bbox.width * canvasWidth,
              bbox.height * canvasHeight
            );
          }

          // Draw key points
          if (detection.landmarks) {
            detection.landmarks.forEach((landmark) => {
              context.fillStyle = '#ff0000';
              context.fillRect(
                landmark.x * canvasWidth - 2,
                landmark.y * canvasHeight - 2,
                4,
                4
              );
            });
          }
        });
      };

      // Draw face tracking on both canvases
      drawFaceTracking(ctx, canvas.width, canvas.height); // Overlay canvas
      drawFaceTracking(compositeCtx, compositeCanvas.width, compositeCanvas.height); // Composite canvas for recording
    }

    // Update the composite stream for recording
    if (isRecording && compositeStreamRef.current) {
      // The composite canvas stream is automatically updated
    }
  }, [isRecording]);

  // Initialize face detection
  const initializeFaceDetection = useCallback(async () => {
    try {
      setError(null); // Clear any previous errors
      setIsLoading(true);
      
      // Try multiple CDN sources for better reliability
      const cdnUrls = [
        'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4.1646425229',
        'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4',
        'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection'
      ];
      
      let faceDetection: FaceDetection | null = null;
      let lastError: Error | null = null;
      
      for (const baseUrl of cdnUrls) {
        try {
          console.log(`Trying to load MediaPipe from: ${baseUrl}`);
          
          faceDetection = new FaceDetection({
            locateFile: (file) => {
              return `${baseUrl}/${file}`;
            }
          });

          faceDetection.setOptions({
            model: 'short',
            minDetectionConfidence: 0.5,
          });

          faceDetection.onResults((results: DetectionResult) => {
            onResults(results);
          });

          await faceDetection.initialize();
          break; // Success, exit loop
        } catch (err) {
          console.warn(`Failed to load from ${baseUrl}:`, err);
          lastError = err as Error;
          faceDetection = null;
        }
      }
      
      if (!faceDetection) {
        throw lastError || new Error('All CDN sources failed');
      }

      faceDetectionRef.current = faceDetection;
      setIsLoading(false);
      
      console.log('Face detection initialized successfully');
    } catch (err) {
      console.error('Error initializing face detection:', err);
      setError('Failed to initialize face detection. Please check your internet connection and refresh the page.');
      setIsLoading(false);
    }
  }, [onResults]);

  // Initialize camera
  const initializeCamera = useCallback(async () => {
    // Wait for face detection to be ready
    if (!faceDetectionRef.current) {
      console.log('Waiting for face detection to initialize...');
      return;
    }

    if (!videoRef.current || !compositeCanvasRef.current) return;

    try {
      setError(null); // Clear any previous errors
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: true
      });

      streamRef.current = stream;
      videoRef.current.srcObject = stream;

      // Wait for video to load metadata
      await new Promise<void>((resolve) => {
        const video = videoRef.current;
        if (video) {
          video.onloadedmetadata = () => resolve();
        }
      });

      // Create composite stream from canvas for recording with face tracking
      const compositeCanvas = compositeCanvasRef.current;
      compositeStreamRef.current = compositeCanvas.captureStream(30); // 30 FPS
      
      // Add audio track from original stream to composite stream
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        compositeStreamRef.current.addTrack(audioTrack);
      }

      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (faceDetectionRef.current && videoRef.current) {
            try {
              await faceDetectionRef.current.send({ image: videoRef.current });
            } catch (err) {
              console.error('Error processing frame:', err);
            }
          }
        },
        width: 1280,
        height: 720
      });

      cameraRef.current = camera;
      camera.start();
      
      console.log('Camera initialized successfully');
    } catch (err) {
      console.error('Error accessing camera:', err);
      setError('Failed to access camera. Please ensure camera permissions are granted.');
    }
  }, []);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  }, [isRecording]);

  // Generate thumbnail from video blob
  const generateThumbnail = useCallback(async (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      video.addEventListener('loadedmetadata', () => {
        // Set canvas size (thumbnail size)
        canvas.width = 160;
        canvas.height = 90;
        
        // Seek to 1 second into the video (or start if video is shorter)
        video.currentTime = Math.min(1, video.duration / 2);
      });

      video.addEventListener('seeked', () => {
        // Draw the video frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to base64 data URL
        const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
        
        // Clean up
        URL.revokeObjectURL(video.src);
        resolve(thumbnail);
      });

      video.addEventListener('error', () => {
        reject(new Error('Error loading video for thumbnail'));
      });

      // Set video source and load
      video.src = URL.createObjectURL(blob);
      video.load();
    });
  }, []);

  // Save recording to IndexedDB
  const saveRecording = useCallback(async () => {
    if (recordedChunksRef.current.length === 0) return;

    const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
    const videoId = `video_${Date.now()}`;
    
    try {
      // Generate thumbnail
      const thumbnail = await generateThumbnail(blob);
      
      // Store in IndexedDB
      const request = indexedDB.open('FaceTrackerDB', 1);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('videos')) {
          db.createObjectStore('videos', { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction(['videos'], 'readwrite');
        const store = transaction.objectStore('videos');
        
        const videoRecord = {
          id: videoId,
          name: `Recording_${new Date().toLocaleString()}`,
          timestamp: Date.now(),
          duration: recordingDuration,
          size: blob.size,
          data: blob
        };

        store.add(videoRecord);
        
        transaction.oncomplete = () => {
          // Update localStorage with video metadata (including thumbnail)
          const savedVideos = JSON.parse(localStorage.getItem('savedVideos') || '[]');
          savedVideos.push({
            id: videoId,
            name: videoRecord.name,
            timestamp: videoRecord.timestamp,
            duration: videoRecord.duration,
            size: videoRecord.size,
            thumbnail: thumbnail
          });
          localStorage.setItem('savedVideos', JSON.stringify(savedVideos));
          setRecordedVideos(savedVideos);
        };
      };
    } catch (err) {
      console.error('Error saving recording:', err);
      setError('Failed to save recording');
    }
  }, [recordingDuration, generateThumbnail]);

  // Start recording
  const startRecording = useCallback(() => {
    // Use composite stream that includes face tracking markers
    if (!compositeStreamRef.current) {
      setError('Composite stream not ready. Please wait for camera initialization.');
      return;
    }

    try {
      const mediaRecorder = new MediaRecorder(compositeStreamRef.current, {
        mimeType: 'video/webm;codecs=vp9'
      });

      recordedChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        saveRecording();
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      // Start duration counter
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Failed to start recording');
    }
  }, [saveRecording]);

  // Load saved videos from localStorage and generate missing thumbnails
  const loadSavedVideos = useCallback(async () => {
    const savedVideos = JSON.parse(localStorage.getItem('savedVideos') || '[]');
    
    // Check for videos without thumbnails and generate them
    const videosNeedingThumbnails = savedVideos.filter((video: RecordedVideo) => !video.thumbnail);
    
    if (videosNeedingThumbnails.length > 0) {
      console.log(`Generating thumbnails for ${videosNeedingThumbnails.length} videos...`);
      
      for (const video of videosNeedingThumbnails) {
        try {
          // Get video data from IndexedDB
          const request = indexedDB.open('FaceTrackerDB', 1);
          request.onsuccess = async (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            const transaction = db.transaction(['videos'], 'readonly');
            const store = transaction.objectStore('videos');
            const getRequest = store.get(video.id);
            
            getRequest.onsuccess = async () => {
              const videoRecord = getRequest.result;
              if (videoRecord && videoRecord.data) {
                try {
                  const thumbnail = await generateThumbnail(videoRecord.data);
                  
                  // Update the video record with thumbnail
                  const index = savedVideos.findIndex((v: RecordedVideo) => v.id === video.id);
                  if (index !== -1) {
                    savedVideos[index].thumbnail = thumbnail;
                  }
                  
                  // Update localStorage
                  localStorage.setItem('savedVideos', JSON.stringify(savedVideos));
                  setRecordedVideos([...savedVideos]);
                } catch (err) {
                  console.warn(`Failed to generate thumbnail for video ${video.id}:`, err);
                }
              }
            };
          };
        } catch (err) {
          console.warn(`Error accessing video ${video.id} for thumbnail generation:`, err);
        }
      }
    }
    
    setRecordedVideos(savedVideos);
  }, [generateThumbnail]);

  // Play saved video
  const playVideo = useCallback(async (videoId: string) => {
    try {
      const request = indexedDB.open('FaceTrackerDB', 1);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction(['videos'], 'readonly');
        const store = transaction.objectStore('videos');
        const getRequest = store.get(videoId);
        
        getRequest.onsuccess = () => {
          const video = getRequest.result;
          if (video) {
            const url = URL.createObjectURL(video.data);
            setSelectedVideo(url);
          }
        };
      };
    } catch (err) {
      console.error('Error loading video:', err);
      setError('Failed to load video');
    }
  }, []);

  // Download video
  const downloadVideo = useCallback(async (videoId: string, videoName: string) => {
    try {
      const request = indexedDB.open('FaceTrackerDB', 1);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction(['videos'], 'readonly');
        const store = transaction.objectStore('videos');
        const getRequest = store.get(videoId);
        
        getRequest.onsuccess = () => {
          const video = getRequest.result;
          if (video) {
            // Create a blob URL for download
            const blob = video.data;
            const url = URL.createObjectURL(blob);
            
            // Create a temporary download link
            const a = document.createElement('a');
            a.href = url;
            a.download = `${videoName.replace(/[^a-zA-Z0-9]/g, '_')}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Clean up the blob URL
            URL.revokeObjectURL(url);
            
            // Show success message
            setSuccessMessage(`Downloaded: ${videoName}`);
            setTimeout(() => setSuccessMessage(null), 3000);
          }
        };
      };
    } catch (err) {
      console.error('Error downloading video:', err);
      setError('Failed to download video');
    }
  }, []);

  // Delete video
  const deleteVideo = useCallback((videoId: string) => {
    try {
      const request = indexedDB.open('FaceTrackerDB', 1);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction(['videos'], 'readwrite');
        const store = transaction.objectStore('videos');
        store.delete(videoId);
        
        transaction.oncomplete = () => {
          const savedVideos = recordedVideos.filter(v => v.id !== videoId);
          localStorage.setItem('savedVideos', JSON.stringify(savedVideos));
          setRecordedVideos(savedVideos);
        };
      };
    } catch (err) {
      console.error('Error deleting video:', err);
      setError('Failed to delete video');
    }
  }, [recordedVideos]);

  // Download all videos as a zip file
  const downloadAllVideos = useCallback(async () => {
    if (recordedVideos.length === 0) return;
    
    try {
      setSuccessMessage(`Downloading ${recordedVideos.length} videos...`);
      
      // For simplicity, download each video individually
      // In a real app, you might want to create a zip file
      for (const video of recordedVideos) {
        await downloadVideo(video.id, video.name);
        // Add a small delay between downloads
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      setSuccessMessage(`Successfully downloaded ${recordedVideos.length} videos!`);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error('Error downloading all videos:', err);
      setError('Failed to download all videos');
    }
  }, [recordedVideos, downloadVideo]);

  // Format file size
  const formatFileSize = useCallback((bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  // Format duration
  const formatDuration = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Initialize everything
  useEffect(() => {
    const init = async () => {
      await initializeFaceDetection();
      loadSavedVideos();
    };
    init();
  }, [initializeFaceDetection, loadSavedVideos]);

  useEffect(() => {
    // Only initialize camera after face detection is ready and not loading
    if (faceDetectionRef.current && !isLoading) {
      initializeCamera();
    }
  }, [initializeCamera, isLoading]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (compositeStreamRef.current) {
        compositeStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      {/* Hidden composite canvas for recording with face tracking */}
      <canvas
        ref={compositeCanvasRef}
        style={{ display: 'none' }}
      />
      
      <div className="text-center">
        <div className="flex justify-center items-center mb-4">
          <FocusIcon size={48} className="text-blue-500" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Face Tracking Video Recorder</h1>
        <p className="text-gray-600">Real-time face detection with video recording capabilities</p>
        
      </div>

      {isLoading && (
        <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-700"></div>
            <span>Initializing face detection...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          <div className="flex justify-between items-center">
            <span>{error}</span>
            <button
              onClick={() => {
                setError(null);
                initializeFaceDetection();
              }}
              className="ml-4 px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
          {successMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Video Section */}
        <div className="space-y-4">
          <div className="relative bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-auto"
            />
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0 w-full h-full pointer-events-none"
            />
            
            {/* Face Detection Indicator */}
            <div className="absolute top-4 left-4">
              <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium ${
                faceDetected ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
              }`}>
                <div className={`w-2 h-2 rounded-full ${faceDetected ? 'bg-white' : 'bg-white'}`} />
                <span>{faceDetected ? 'Face Detected' : 'No Face'}</span>
              </div>
            </div>

            {/* Recording Indicator */}
            {isRecording && (
              <div className="absolute top-4 right-4">
                <div className="flex items-center space-x-2 px-3 py-1 bg-red-500 text-white rounded-full text-sm font-medium">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  <span>REC {formatDuration(recordingDuration)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex justify-center space-x-4">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!compositeStreamRef.current}
              className={`px-6 py-3 rounded-lg font-medium transition-colors flex items-center space-x-2 ${
                isRecording 
                  ? 'bg-red-500 hover:bg-red-600 text-white' 
                  : 'bg-blue-500 hover:bg-blue-600 text-white disabled:bg-gray-300'
              }`}
            >
              {isRecording ? <VideoOff size={20} /> : <Video size={20} />}
              <span>{isRecording ? 'Stop Recording' : 'Start Recording'}</span>
            </button>
          </div>
        </div>

        {/* Saved Videos Section */}
        <div className="space-y-4">
          <div className="flex justify-between text-black items-center">
            <h2 className="text-xl font-semibold">Saved Videos ({recordedVideos.length})</h2>
            {recordedVideos.length > 0 && (
              <button
                onClick={downloadAllVideos}
                className="px-3 py-1 bg-purple-500 text-white text-sm rounded hover:bg-purple-600 flex items-center space-x-1"
              >
                <Download size={14} />
                <span>Download All</span>
              </button>
            )}
          </div>
          
          {selectedVideo && (
            <div className="bg-gray-100 rounded-lg p-4">
              <h3 className="font-medium mb-2">Video Playback</h3>
              <video
                src={selectedVideo}
                controls
                className="w-full rounded"
                onEnded={() => setSelectedVideo(null)}
              />
              <button
                onClick={() => setSelectedVideo(null)}
                className="mt-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Close
              </button>
            </div>
          )}

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {recordedVideos.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No recordings yet</p>
            ) : (
              recordedVideos.map((video) => (
                <div key={video.id} className="bg-white border rounded-lg p-4 space-y-3">
                  <div className="flex space-x-3">
                    {/* Thumbnail */}
                    <div className="flex-shrink-0">
                      {video.thumbnail ? (
                        <div 
                          className="relative group cursor-pointer"
                          onClick={() => playVideo(video.id)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={video.thumbnail}
                            alt={`Thumbnail for ${video.name}`}
                            className="w-20 h-12 object-cover rounded hover:opacity-80 transition-opacity"
                          />
                          {/* Play overlay */}
                          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all rounded">
                            <Play size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      ) : (
                        <div className="w-20 h-12 bg-gray-200 rounded flex items-center justify-center">
                          <Video size={16} className="text-gray-400" />
                        </div>
                      )}
                    </div>
                    
                    {/* Video Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-black truncate">{video.name}</h3>
                      <p className="text-sm text-gray-500">
                        {new Date(video.timestamp).toLocaleString()}
                      </p>
                      <p className="text-sm text-gray-500">
                        Duration: {formatDuration(video.duration)} • Size: {formatFileSize(video.size)}
                      </p>
                    </div>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex space-x-2">
                    <button
                      onClick={() => playVideo(video.id)}
                      className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 flex items-center space-x-1"
                    >
                      <Play size={14} />
                      <span>Play</span>
                    </button>
                    <button
                      onClick={() => downloadVideo(video.id, video.name)}
                      className="px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600 flex items-center space-x-1"
                    >
                      <Download size={14} />
                      <span>Download</span>
                    </button>
                    <button
                      onClick={() => deleteVideo(video.id)}
                      className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600 flex items-center space-x-1"
                    >
                      <Trash2 size={14} />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
