import { useEffect } from 'react';
import { API } from '../config/api';
import { installSessionActivity } from '../utils/session-activity';

export default function SessionActivity() {
  useEffect(() => installSessionActivity(API), []);
  return null;
}
