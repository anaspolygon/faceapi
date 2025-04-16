"use client";
import React, { useEffect, useRef, useState } from "react";
import * as faceapi from "face-api.js";
import Image from "next/image";

const Liveliness = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [expressionPrompt, setExpressionPrompt] = useState("Please smile 😄");
  const [capturedExpressions, setCapturedExpressions] = useState<
    { prompt: string; detected?: object; ear?: number }[]
  >([]);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);

  const prompts = [
    { label: "Please smile 😄", key: "happy", type: "expression" },
    { label: "Please blink 👁️", key: "blink", type: "blink" },
    { label: "Look left 👈", key: "left", type: "pose" },
    { label: "Look right 👉", key: "right", type: "pose" },
    { label: "Look up 👆", key: "up", type: "pose" },
    { label: "Look down 👇", key: "down", type: "pose" },
  ];

  const [promptIndex, setPromptIndex] = useState(0);
  const threshold = 0.9;
  const EAR_THRESHOLD = 0.20;
  const captureFlag = useRef(true);

  const loadModels = async () => {
    const MODEL_URL = "/models";
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL + "/tiny_face_detector");
    await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL + "/face_expression");
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL + "/face_landmark_68");
  };

  const startVideo = () => {
    navigator.mediaDevices
      .getUserMedia({ video: {} })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => console.error("Webcam error:", err));
  };

  const captureImage = () => {
    if (videoRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const imageData = canvas.toDataURL("image/png");
        setCapturedImages((prev) => [...prev, imageData]);
      }
    }
  };

  useEffect(() => {
    loadModels().then(startVideo);

    videoRef.current &&
      videoRef.current.addEventListener("play", () => {
        if (!videoRef.current) return;
        const canvas = faceapi.createCanvasFromMedia(videoRef.current);
        document.body.append(canvas);

        const displaySize = {
          width: videoRef.current.width,
          height: videoRef.current.height,
        };
        faceapi.matchDimensions(canvas, displaySize);

        setInterval(async () => {
          let detection;
          if (videoRef.current) {
            detection = await faceapi
              .detectSingleFace(
                videoRef.current,
                new faceapi.TinyFaceDetectorOptions()
              )
              .withFaceLandmarks()
              .withFaceExpressions();
          }

          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }

          if (detection) {
            const resizedDetection = faceapi.resizeResults(detection, displaySize);
            faceapi.draw.drawDetections(canvas, resizedDetection);
            faceapi.draw.drawFaceExpressions(canvas, resizedDetection);
            faceapi.draw.drawFaceLandmarks(canvas, resizedDetection);

            const expressions = detection.expressions;
            const landmarks = detection.landmarks;

            const currentPrompt = prompts[promptIndex];
            if (currentPrompt) {
              if (currentPrompt.type === "expression") {
                const confidence = expressions[currentPrompt.key as keyof typeof expressions];
                if (typeof confidence === "number" && confidence >= threshold && captureFlag.current) {
                  captureFlag.current = false;
                  captureImage();
                  captureExpression(currentPrompt.label, Object.fromEntries(Object.entries(expressions)));
                }
              } else if (currentPrompt.type === "blink") {
                const leftEye = landmarks.getLeftEye();
                const rightEye = landmarks.getRightEye();

                const computeEAR = (eye: { x: number; y: number }[]) => {
                  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
                    Math.hypot(a.x - b.x, a.y - b.y);
                  const vertical1 = dist(eye[1], eye[5]);
                  const vertical2 = dist(eye[2], eye[4]);
                  const horizontal = dist(eye[0], eye[3]);
                  return (vertical1 + vertical2) / (2.0 * horizontal);
                };

                const leftEAR = computeEAR(leftEye);
                const rightEAR = computeEAR(rightEye);
                const avgEAR = (leftEAR + rightEAR) / 2.0;

                if (avgEAR < EAR_THRESHOLD && captureFlag.current) {
                  captureFlag.current = false;
                  captureImage();
                  captureBlink(avgEAR);
                }
              } else if (currentPrompt.type === "pose") {
                const nose = landmarks.getNose()[3];
                const box = detection.detection.box;
                const noseX = (nose.x - box.x) / box.width;
                const noseY = (nose.y - box.y) / box.height;

                if (captureFlag.current) {
                  if (currentPrompt.key === "left" && noseX < 0.4) {
                    captureFlag.current = false;
                    captureImage();
                    capturePose("Left");
                  } else if (currentPrompt.key === "right" && noseX > 0.6) {
                    captureFlag.current = false;
                    captureImage();
                    capturePose("Right");
                  } else if (currentPrompt.key === "up" && noseY < 0.4) {
                    captureFlag.current = false;
                    captureImage();
                    capturePose("Up");
                  } else if (currentPrompt.key === "down" && noseY > 0.6) {
                    captureFlag.current = false;
                    captureImage();
                    capturePose("Down");
                  }
                }
              }
            }
          }
        }, 500);
      });
  }, [promptIndex]);

  const goToNextPrompt = () => {
    const nextIndex = promptIndex + 1;
    if (nextIndex < prompts.length) {
      setPromptIndex(nextIndex);
      setExpressionPrompt(prompts[nextIndex].label);
      setTimeout(() => {
        captureFlag.current = true;
      }, 1000);
    } else {
      setExpressionPrompt("All done!");
    }
  };

  const captureExpression = (promptLabel: string, expressions: Record<string, number>) => {
    setCapturedExpressions((prev) => [
      ...prev,
      { prompt: promptLabel, detected: expressions },
    ]);
    goToNextPrompt();
  };

  const captureBlink = (earValue: number) => {
    setCapturedExpressions((prev) => [
      ...prev,
      { prompt: "Blink detected 👁️", ear: earValue },
    ]);
    goToNextPrompt();
  };

  const capturePose = (poseLabel: string) => {
    setCapturedExpressions((prev) => [
      ...prev,
      { prompt: `Face turned ${poseLabel}` },
    ]);
    goToNextPrompt();
  };

  return (
    <div className="p-4">
      <h2 className="text-xl mb-2">Auto Expression, Blink & Pose Capture</h2>
      <p className="text-lg mb-4">{expressionPrompt}</p>
      <video
        ref={videoRef}
        autoPlay
        muted
        width="720"
        height="560"
        className="border"
      />

      <div className="mt-6">
        <h3 className="text-lg font-semibold">Captured Results:</h3>
        <ul>
          {capturedExpressions?.map((item, index) => (
            <li key={index} className="mt-2">
              <strong>{item.prompt}</strong>
              {item.detected && ` ${JSON.stringify(item.detected)}`}
              {item.ear !== undefined && ` (EAR: ${item.ear.toFixed(3)})`}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        <h3 className="text-lg font-semibold">Captured Images:</h3>
        <div className="flex flex-wrap gap-4 mt-2">
          {capturedImages.map((img, index) => (
            <Image
              key={index}
              src={img}
              alt={`capture-${index}`}
              className="border w-48"
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Liveliness;
